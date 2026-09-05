
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
