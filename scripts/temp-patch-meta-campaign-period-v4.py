#!/usr/bin/env python3
from pathlib import Path
from textwrap import dedent

api_path = Path('supabase/functions/api/index.ts')
source = api_path.read_text(encoding='utf-8')

required_old = [
    'async function fetchDbCampaigns',
    'campaigns: [...metaCampaigns, ...dbOnlyCampaigns]',
    'Campaign data sourced from CRM — Meta API returned no campaigns.',
    "await setMetaCache(adminClient, userId, `meta:campaigns`, result);",
    "const dbCampaigns = await fetchDbCampaigns(adminClient, userId, clinicId, '');",
]
missing = [value for value in required_old if value not in source]
if missing:
    raise SystemExit(f'Expected pre-fix campaign contract missing: {missing}')

helper_marker = '\n/** Derives the `time_range` JSON string for the Meta campaigns list fetch.'
helper = dedent('''
function campaignHasPeriodActivity(campaign: any): boolean {
  const insights = campaign?.insights;
  if (!insights) return false;

  return (
    parseMetaMetric(insights.impressions) > 0
    || parseMetaMetric(insights.reach) > 0
    || parseMetaMetric(insights.clicks) > 0
    || parseMetaMetric(insights.spend) > 0
    || parseMetaMetric(insights.conversions) > 0
    || (Array.isArray(insights.actions)
      && insights.actions.some((action: any) => parseMetaMetric(action?.value) > 0))
  );
}
''')
if 'function campaignHasPeriodActivity' not in source:
    source = source.replace(helper_marker, '\n' + helper + helper_marker, 1)

old_signature = 'async function fetchDbCampaigns(adminClient: any, userId: string, requesterClinicId: string | null, adAccountId: string) {'
new_signature = 'async function fetchDbCampaigns(adminClient: any, userId: string, requesterClinicId: string | null) {'
if old_signature not in source:
    raise SystemExit('Historical CRM campaign helper signature changed unexpectedly')
source = source.replace(old_signature, new_signature, 1)

db_start = source.index('async function fetchDbCampaigns')
db_end = source.index('async function fetchMetaCampaignsFallback', db_start)
db_section = source[db_start:db_end]
if 'accountId: adAccountId,' not in db_section:
    raise SystemExit('Expected synthesized CRM accountId assignment is missing')
db_section = db_section.replace(
    'accountId: adAccountId,',
    "accountId: null,\n    provenance: 'crm_history',\n    telemetryAvailable: false,",
    1,
)
source = source[:db_start] + db_section + source[db_end:]
source = source.replace(
    "const dbCampaigns = await fetchDbCampaigns(adminClient, userId, clinicId, '');",
    'const dbCampaigns = await fetchDbCampaigns(adminClient, userId, clinicId);',
    1,
)

fallback_start = source.index('async function fetchMetaCampaignsFallback')
fallback_end = source.index('async function handleMetaCampaignsGet', fallback_start)
fallback = dedent('''
async function fetchMetaCampaignsFallback(params: {
  creds: any;
  sendJson: any;
  e: Error;
  adminClient: any;
  userId: string;
  campFrom: string;
  campTo: string;
}) {
  const { creds, sendJson, e, adminClient, userId, campFrom, campTo } = params;
  const cacheKey = buildMetaCacheKey('meta:campaigns', creds.adAccountIds, campFrom, campTo, null);
  const cached = await getMetaCache(adminClient, userId, cacheKey);

  if (cached) {
    return sendJson({
      ...cached.data,
      source: cached.data?.source || 'cache',
      cached: true,
      degraded: true,
      accountId: creds.adAccountId,
      accountIds: creds.adAccountIds,
      period: { since: campFrom, until: campTo },
      last_success: cached.updated_at,
      warning: `Meta API unavailable: ${e.message}. Showing the last verified campaign snapshot for this exact period.`,
    });
  }

  return sendJson({
    success: false,
    metaApiError: true,
    degraded: true,
    accountId: creds.adAccountId,
    accountIds: creds.adAccountIds,
    period: { since: campFrom, until: campTo },
    message: `Meta campaign activity unavailable for ${campFrom} to ${campTo}: ${e.message}`,
  }, 502);
}

''')
source = source[:fallback_start] + fallback + source[fallback_end:]

live_start = source.index('async function getMetaCampaignsLiveResult')
live_end = source.index('function mapMetaAd', live_start)
live = dedent('''
async function getMetaCampaignsLiveResult(
  creds: any,
  adminClient: any,
  userId: string,
  sendJson: any,
  campFrom: string,
  campTo: string,
): Promise<Response> {
  const insightsDateParam = `time_range(${JSON.stringify({ since: campFrom, until: campTo })})`;
  const cacheKey = buildMetaCacheKey('meta:campaigns', creds.adAccountIds, campFrom, campTo, null);

  try {
    const accountResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
      const [campaigns, account] = await Promise.all([
        metaFetchAll(`/${accountId}/campaigns`, {
          fields: `id,name,status,objective,daily_budget,lifetime_budget,insights.${insightsDateParam}{impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking}`,
          limit: '500',
        }, creds.accessToken),
        metaFetch(`/${accountId}`, { fields: 'currency' }, creds.accessToken),
      ]);
      return { accountId, campaigns, currency: account?.currency ?? 'EUR' };
    }));

    const failedAccountIds = creds.adAccountIds.filter((_: string, index: number) => accountResults[index].status === 'rejected');
    if (failedAccountIds.length > 0) {
      throw new Error(`Meta campaign fetch failed for account(s): ${failedAccountIds.join(', ')}`);
    }

    const successfulAccounts = accountResults
      .filter(isFulfilled)
      .map((result) => result.value);

    const campCurrency: string = successfulAccounts.find((acct: any) => acct.currency)?.currency ?? 'EUR';
    const campaigns = successfulAccounts.flatMap((acct: any) => ((acct.campaigns ?? []) as any[])
      .map((campaign) => ({ ...campaign, accountId: acct.accountId })));
    const metaCampaigns = campaigns
      .map(mapMetaCampaign)
      .filter(campaignHasPeriodActivity);

    const result = {
      success: true,
      source: 'live',
      cached: false,
      degraded: false,
      accountId: creds.adAccountId,
      accountIds: creds.adAccountIds,
      currency: campCurrency,
      period: { since: campFrom, until: campTo },
      campaigns: metaCampaigns,
    };
    await setMetaCache(adminClient, userId, cacheKey, result);
    return sendJson(result);
  } catch (e: any) {
    return fetchMetaCampaignsFallback({ creds, sendJson, e, adminClient, userId, campFrom, campTo });
  }
}

''')
source = source[:live_start] + live + source[live_end:]

forbidden = [
    'campaigns: [...metaCampaigns, ...dbOnlyCampaigns]',
    'Campaign data sourced from CRM — Meta API returned no campaigns.',
    'Status inferred from last CRM lead:',
    'accountId: adAccountId,',
]
remaining = [value for value in forbidden if value in source]
if remaining:
    raise SystemExit(f'Forbidden campaign provenance mixing remains: {remaining}')

api_path.write_text(source, encoding='utf-8')

tenant_path = Path('supabase/tests/meta-tenant-resolution-contract.test.mjs')
tenant = tenant_path.read_text(encoding='utf-8')
tenant = tenant.replace(
    "it('scopes campaign CRM fallback through clinic member user IDs instead of a non-existent view clinic_id', () => {",
    "it('scopes historical CRM campaign snapshots for AI through clinic member user IDs', () => {",
    1,
)
tenant_path.write_text(tenant, encoding='utf-8')

contract = dedent('''
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const api = readFileSync('supabase/functions/api/index.ts', 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = api.indexOf(startMarker);
  const end = api.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return api.slice(start, end);
}

describe('Meta operational campaign period contract', () => {
  it('keeps CRM and Doctoralia history out of the operational Meta campaign endpoint', () => {
    const fallback = sliceBetween('async function fetchMetaCampaignsFallback', 'async function handleMetaCampaignsGet');
    const live = sliceBetween('async function getMetaCampaignsLiveResult', 'function mapMetaAd');

    expect(fallback).not.toContain('fetchDbCampaigns(');
    expect(fallback).not.toContain('vw_campaign_performance_real');
    expect(fallback).not.toContain('Campaign data sourced from CRM');
    expect(live).not.toContain('dbOnlyCampaigns');
    expect(live).not.toContain('fetchDbCampaigns(');
    expect(live).not.toContain('campaigns: [...metaCampaigns');
  });

  it('publishes only campaigns with verified provider activity in the requested period', () => {
    const helper = sliceBetween('function campaignHasPeriodActivity', '/** Derives the `time_range`');
    const live = sliceBetween('async function getMetaCampaignsLiveResult', 'function mapMetaAd');

    for (const metric of ['impressions', 'reach', 'clicks', 'spend', 'conversions', 'actions']) {
      expect(helper).toContain(metric);
    }
    expect(live).toContain('.filter(campaignHasPeriodActivity)');
    expect(live).toContain('period: { since: campFrom, until: campTo }');
    expect(live).toContain("buildMetaCacheKey('meta:campaigns', creds.adAccountIds, campFrom, campTo, null)");
  });

  it('fails closed or uses only an exact-period verified cache when Meta cannot prove activity', () => {
    const fallback = sliceBetween('async function fetchMetaCampaignsFallback', 'async function handleMetaCampaignsGet');

    expect(fallback).toContain("buildMetaCacheKey('meta:campaigns', creds.adAccountIds, campFrom, campTo, null)");
    expect(fallback).toContain('last verified campaign snapshot for this exact period');
    expect(fallback).toContain('metaApiError: true');
    expect(fallback).toContain('}, 502);');
    expect(fallback).not.toContain('returned campaign metadata only');
  });

  it('requires complete provider coverage across configured Meta accounts', () => {
    const live = sliceBetween('async function getMetaCampaignsLiveResult', 'function mapMetaAd');
    expect(live).toContain('failedAccountIds.length > 0');
    expect(live).toContain('Meta campaign fetch failed for account(s)');
    expect(live).toContain('degraded: false');
  });

  it('keeps CRM history available to AI without fabricating Meta account provenance', () => {
    const history = sliceBetween('async function fetchDbCampaigns', 'async function fetchMetaCampaignsFallback');
    const ai = sliceBetween('async function autoFetchCampaignDataForAi', 'function buildAnalyzeCampaignPrompt');

    expect(history).toContain("provenance: 'crm_history'");
    expect(history).toContain('telemetryAvailable: false');
    expect(history).toContain('accountId: null');
    expect(history).not.toContain('accountId: adAccountId');
    expect(ai).toContain('fetchDbCampaigns(adminClient, userId, clinicId)');
  });
});
''')
Path('supabase/functions/meta-campaign-period-scope-contract.test.mjs').write_text(contract, encoding='utf-8')
