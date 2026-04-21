#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const META_GRAPH = 'https://graph.facebook.com/v21.0';
const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v17';

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeAdAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replace(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

function parseMetric(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (Array.isArray(raw)) {
    return raw.reduce((sum, item) => sum + parseMetric(item && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item), 0);
  }
  if (typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return parseMetric(raw.value);
  }
  return 0;
}

function actionValue(actions, matcher) {
  if (!Array.isArray(actions) || actions.length === 0) return 0;
  return actions.reduce((sum, action) => {
    const type = String(action?.action_type || '').toLowerCase();
    if (!matcher(type)) return sum;
    return sum + parseMetric(action?.value);
  }, 0);
}

function isWhatsAppAction(type) {
  return type.includes('whatsapp') || type.includes('messaging');
}

function isLeadFormAction(type) {
  if (!type.includes('lead')) return false;
  return !type.includes('qualified');
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function eur(value) {
  const n = Number(value || 0);
  return `EUR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function numberFmt(value) {
  return Number(value || 0).toLocaleString();
}

// ── Google Ads helpers ───────────────────────────────────────────────────────

function b64url(data) {
  const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
  return buf.toString('base64url');
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud:   serviceAccount.token_uri || 'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(serviceAccount.private_key, 'base64url');
  const jwtToken = `${header}.${payload}.${sig}`;

  const tokenUrl = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwtToken}`,
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error_description || `Google OAuth: ${data.error}`);
  return data.access_token;
}

async function fetchGoogleAdsInsights({ devToken, customerId, serviceAccount, since, until }) {
  const accessToken = await getGoogleAccessToken(serviceAccount);
  const cleanId = customerId.replace(/-/g, '');
  const query = `
    SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks,
           metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${since}' AND '${until}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;
  const resp = await fetch(`${GOOGLE_ADS_API}/customers/${cleanId}/googleAds:search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': devToken,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const msg = data.error?.details?.[0]?.errors?.[0]?.message ?? data.error?.message ?? `Google Ads ${resp.status}`;
    throw new Error(msg);
  }
  return data.results || [];
}

function summariseGoogleAds(results) {
  return results.map((r) => ({
    id:          r.campaign?.id        || 'unknown',
    name:        r.campaign?.name      || 'Unnamed campaign',
    impressions: Number(r.metrics?.impressions   || 0),
    clicks:      Number(r.metrics?.clicks        || 0),
    spend:       Number(r.metrics?.cost_micros   || 0) / 1_000_000,
    conversions: Number(r.metrics?.conversions   || 0),
    ctr:         Number(r.metrics?.ctr           || 0) * 100,
    avgCpc:      Number(r.metrics?.average_cpc   || 0) / 1_000_000,
  }));
}

// ─── Meta fetch ──────────────────────────────────────────────────────────────

async function metaFetch(endpoint, params, token) {
  const url = new URL(`${META_GRAPH}${endpoint}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Meta API ${response.status}`);
  }

  return data;
}

async function maybeLoadDbSignals({ databaseUrl, clinicId, sinceIso, untilExclusiveIso }) {
  if (!databaseUrl || !clinicId) {
    return { available: false, rows: [] };
  }

  const { Client } = require('pg');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const query = `
      select
        l.source,
        count(*)::int as total,
        count(*) filter (where l.first_outbound_at is not null)::int as contacted,
        count(*) filter (where l.first_inbound_at is not null)::int as replied,
        count(*) filter (where l.appointment_status in ('scheduled','confirmed','showed'))::int as booked,
        count(*) filter (where l.stage = 'closed' or l.verified_revenue > 0)::int as closed_won
      from public.leads l
      join public.users u on u.id = l.user_id
      where u.clinic_id = $1
        and l.created_at >= $2::timestamptz
        and l.created_at < $3::timestamptz
        and l.source in ('whatsapp', 'meta_leadgen', 'meta_lead_gen', 'facebook_leadgen')
      group by l.source
      order by total desc
    `;

    const { rows } = await db.query(query, [clinicId, `${sinceIso}T00:00:00Z`, `${untilExclusiveIso}T00:00:00Z`]);
    return { available: true, rows };
  } finally {
    await db.end();
  }
}

async function maybePersistOutput({ databaseUrl, reportUserId, clinicId, markdown, metadata }) {
  if (!databaseUrl || !reportUserId) return null;

  const { Client } = require('pg');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();

  try {
    const insert = `
      insert into public.agent_outputs (user_id, clinic_id, agent_type, output, metadata)
      values ($1, $2, 'campaign_analyzer', $3::jsonb, $4::jsonb)
      returning id
    `;
    const { rows } = await db.query(insert, [reportUserId, clinicId || null, JSON.stringify({ content: markdown }), JSON.stringify(metadata)]);
    return rows?.[0]?.id || null;
  } finally {
    await db.end();
  }
}

function buildGoogleAdsMarkdown(campaigns) {
  if (!campaigns || campaigns.length === 0) return '';
  const gTotals = campaigns.reduce((a, r) => {
    a.spend += r.spend; a.clicks += r.clicks; a.impressions += r.impressions; a.conversions += r.conversions;
    return a;
  }, { spend: 0, clicks: 0, impressions: 0, conversions: 0 });

  const lines = [];
  lines.push('## Google Ads — Campaign Summary');
  lines.push('');
  lines.push(`- Total Spend: ${eur(gTotals.spend)}`);
  lines.push(`- Total Clicks: ${numberFmt(gTotals.clicks)}`);
  lines.push(`- Total Impressions: ${numberFmt(gTotals.impressions)}`);
  lines.push(`- Conversions: ${numberFmt(gTotals.conversions)}`);
  lines.push('');
  lines.push('| Campaign | Spend | Clicks | Conversions | CTR |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const c of campaigns.slice(0, 10)) {
    lines.push(`| ${c.name} | ${eur(c.spend)} | ${numberFmt(c.clicks)} | ${numberFmt(c.conversions)} | ${c.ctr.toFixed(2)}% |`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildMarkdown({
  generatedAt,
  period,
  account,
  totals,
  channels,
  campaigns,
  landing,
  dbSignals,
  googleAdsCampaigns,
  recommendations,
}) {
  const lines = [];

  lines.push('# Weekly Unified Meta Ads Report');
  lines.push('');
  lines.push(`- Generated at (UTC): ${generatedAt}`);
  lines.push(`- Ad account: ${account}`);
  lines.push(`- Window: ${period.since} to ${period.until}`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`- Spend: ${eur(totals.spend)}`);
  lines.push(`- Impressions: ${numberFmt(totals.impressions)}`);
  lines.push(`- Clicks: ${numberFmt(totals.clicks)}`);
  lines.push(`- CTR: ${totals.ctr.toFixed(2)}%`);
  lines.push(`- CPC: ${eur(totals.cpc)}`);
  lines.push(`- Estimated WhatsApp conversions: ${numberFmt(totals.whatsAppLeads)}`);
  lines.push(`- Estimated Lead Form conversions: ${numberFmt(totals.formLeads)}`);
  lines.push('');

  lines.push('## Channel Comparison (WhatsApp vs Lead Forms)');
  lines.push('');
  lines.push('| Channel | Estimated Leads | Campaign Spend | Estimated CPL | Share of Leads |');
  lines.push('|---|---:|---:|---:|---:|');
  lines.push(`| WhatsApp | ${numberFmt(channels.whatsapp.leads)} | ${eur(channels.whatsapp.spend)} | ${channels.whatsapp.cpl > 0 ? eur(channels.whatsapp.cpl) : 'n/a'} | ${channels.whatsapp.share.toFixed(1)}% |`);
  lines.push(`| Lead Forms | ${numberFmt(channels.forms.leads)} | ${eur(channels.forms.spend)} | ${channels.forms.cpl > 0 ? eur(channels.forms.cpl) : 'n/a'} | ${channels.forms.share.toFixed(1)}% |`);
  lines.push('');

  lines.push('## Campaigns Performing Best (by estimated leads)');
  lines.push('');
  lines.push('| Campaign | Channel Focus | Spend | Leads | Estimated CPL |');
  lines.push('|---|---|---:|---:|---:|');
  if (campaigns.best.length === 0) {
    lines.push('| No campaign data | - | - | - | - |');
  } else {
    for (const row of campaigns.best) {
      lines.push(`| ${row.name} | ${row.primaryChannel} | ${eur(row.spend)} | ${numberFmt(row.totalLeads)} | ${row.cpl > 0 ? eur(row.cpl) : 'n/a'} |`);
    }
  }
  lines.push('');

  lines.push('## Campaigns Wasting Budget (spend high, low/zero leads)');
  lines.push('');
  lines.push('| Campaign | Spend | Leads | Estimated CPL |');
  lines.push('|---|---:|---:|---:|');
  if (campaigns.waste.length === 0) {
    lines.push('| No clear budget waste detected for this window | - | - | - |');
  } else {
    for (const row of campaigns.waste) {
      lines.push(`| ${row.name} | ${eur(row.spend)} | ${numberFmt(row.totalLeads)} | ${row.cpl > 0 ? eur(row.cpl) : 'n/a'} |`);
    }
  }
  lines.push('');

  lines.push('## Landing Funnel (click to landing view)');
  lines.push('');
  lines.push(`- Outbound/Link clicks: ${numberFmt(landing.clicks)}`);
  lines.push(`- Landing page views: ${numberFmt(landing.views)}`);
  lines.push(`- Landing conversion rate: ${landing.rate.toFixed(1)}%`);
  lines.push('');

  if (dbSignals.available) {
    lines.push('## CRM Response Funnel by Source (last 7 days)');
    lines.push('');
    lines.push('| Source | Leads | Contacted | Replied | Booked | Closed Won | Reply Rate | Booking Rate |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    if (dbSignals.rows.length === 0) {
      lines.push('| No CRM leads found in this window | - | - | - | - | - | - | - |');
    } else {
      for (const row of dbSignals.rows) {
        const replyRate = pct(row.replied, row.contacted || row.total);
        const bookingRate = pct(row.booked, row.replied || row.total);
        lines.push(`| ${row.source} | ${row.total} | ${row.contacted} | ${row.replied} | ${row.booked} | ${row.closed_won} | ${replyRate.toFixed(1)}% | ${bookingRate.toFixed(1)}% |`);
      }
    }
    lines.push('');
  }

  const googleSection = buildGoogleAdsMarkdown(googleAdsCampaigns);
  if (googleSection) {
    lines.push(googleSection);
  }

  lines.push('## Recommended Actions for Next Day');
  lines.push('');
  recommendations.forEach((item, idx) => {
    lines.push(`${idx + 1}. ${item}`);
  });
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function main() {
  const token = process.env.META_ACCESS_TOKEN;
  const rawAccount = process.env.META_AD_ACCOUNT_ID;
  const databaseUrl = process.env.DATABASE_URL || '';
  const clinicId = process.env.CLINIC_ID || '';
  const reportUserId = process.env.REPORT_USER_ID || '';

  // Google Ads (optional)
  const gServiceAccountRaw = process.env.GOOGLE_ADS_SERVICE_ACCOUNT || '';
  const gDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  const gCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID || '';
  let googleServiceAccount = null;
  if (gServiceAccountRaw && gDevToken && gCustomerId) {
    try {
      // Support both raw JSON and base64-encoded JSON
      const raw = gServiceAccountRaw.startsWith('{') ? gServiceAccountRaw
        : Buffer.from(gServiceAccountRaw, 'base64').toString('utf8');
      googleServiceAccount = JSON.parse(raw);
    } catch {
      console.warn('[meta-daily-report] Invalid GOOGLE_ADS_SERVICE_ACCOUNT — skipping Google Ads section');
    }
  }

  if (!token || !rawAccount) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required');
  }

  const adAccountId = normalizeAdAccountId(rawAccount);
  if (!adAccountId) {
    throw new Error('META_AD_ACCOUNT_ID has invalid format');
  }

  const today = new Date();
  // Daily window = yesterday
  const untilDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  untilDate.setUTCDate(untilDate.getUTCDate() - 1);
  const sinceDate = new Date(untilDate); // since == until for 1-day window

  const since = formatDateUTC(sinceDate);
  const until = formatDateUTC(untilDate);
  const untilExclusive = formatDateUTC(new Date(untilDate.getTime() + 86400000));

  const baseFields = [
    'campaign_id',
    'campaign_name',
    'impressions',
    'clicks',
    'spend',
    'ctr',
    'cpc',
    'cpm',
    'actions',
    'outbound_clicks',
    'inline_link_clicks',
    'landing_page_view',
  ].join(',');

  const insights = await metaFetch(`/${adAccountId}/insights`, {
    level: 'campaign',
    fields: baseFields,
    time_range: JSON.stringify({ since, until }),
    limit: '300',
  }, token);

  const rows = Array.isArray(insights?.data) ? insights.data : [];

  const campaignRows = rows.map((row) => {
    const spend = parseMetric(row.spend);
    const impressions = parseMetric(row.impressions);
    const clicks = parseMetric(row.clicks || row.inline_link_clicks || row.outbound_clicks);
    const landingPageViews = parseMetric(row.landing_page_view);
    const waLeads = actionValue(row.actions, isWhatsAppAction);
    const formLeads = actionValue(row.actions, isLeadFormAction);
    const totalLeads = waLeads + formLeads;
    const primaryChannel = waLeads > formLeads ? 'WhatsApp' : (formLeads > waLeads ? 'Lead Form' : 'Mixed/Unknown');

    return {
      id: row.campaign_id || 'unknown',
      name: row.campaign_name || 'Unnamed campaign',
      spend,
      impressions,
      clicks,
      landingPageViews,
      waLeads,
      formLeads,
      totalLeads,
      primaryChannel,
      cpl: totalLeads > 0 ? spend / totalLeads : 0,
      isWaste: spend > 0 && totalLeads === 0,
    };
  });

  const totals = campaignRows.reduce((acc, row) => {
    acc.spend += row.spend;
    acc.impressions += row.impressions;
    acc.clicks += row.clicks;
    acc.whatsAppLeads += row.waLeads;
    acc.formLeads += row.formLeads;
    return acc;
  }, {
    spend: 0,
    impressions: 0,
    clicks: 0,
    whatsAppLeads: 0,
    formLeads: 0,
  });

  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;

  const channelLeadTotal = totals.whatsAppLeads + totals.formLeads;
  const whatsappSpend = campaignRows
    .filter((r) => r.primaryChannel === 'WhatsApp')
    .reduce((sum, r) => sum + r.spend, 0);
  const formsSpend = campaignRows
    .filter((r) => r.primaryChannel === 'Lead Form')
    .reduce((sum, r) => sum + r.spend, 0);

  const channels = {
    whatsapp: {
      leads: totals.whatsAppLeads,
      spend: whatsappSpend,
      cpl: totals.whatsAppLeads > 0 ? whatsappSpend / totals.whatsAppLeads : 0,
      share: channelLeadTotal > 0 ? (totals.whatsAppLeads / channelLeadTotal) * 100 : 0,
    },
    forms: {
      leads: totals.formLeads,
      spend: formsSpend,
      cpl: totals.formLeads > 0 ? formsSpend / totals.formLeads : 0,
      share: channelLeadTotal > 0 ? (totals.formLeads / channelLeadTotal) * 100 : 0,
    },
  };

  const bestCampaigns = [...campaignRows]
    .sort((a, b) => (b.totalLeads - a.totalLeads) || (b.spend - a.spend))
    .slice(0, 6);

  const wasteCampaigns = [...campaignRows]
    .filter((row) => row.isWaste || (row.spend > 0 && row.cpl > 3 * (totals.cpc || 1)))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6);

  const landingViews = campaignRows.reduce((sum, row) => sum + parseMetric(row.landingPageViews), 0);
  const landing = {
    clicks: totals.clicks,
    views: landingViews,
    rate: totals.clicks > 0 ? (landingViews / totals.clicks) * 100 : 0,
  };

  const dbSignals = await maybeLoadDbSignals({
    databaseUrl,
    clinicId,
    sinceIso: since,
    untilExclusiveIso: untilExclusive,
  });

  const recommendations = [];
  const winner = channels.whatsapp.leads > channels.forms.leads ? 'WhatsApp' : 'Lead Forms';
  recommendations.push(`Scale budget toward ${winner} next week, but keep at least 20% exploration budget on the other channel.`);

  if (landing.rate < 50) {
    recommendations.push('Landing conversion is low: optimize load speed and message match between ad copy and landing page content.');
  } else {
    recommendations.push('Landing conversion is healthy: prioritize creative and audience testing to improve conversion quality.');
  }

  if (wasteCampaigns.length > 0) {
    recommendations.push('Pause or cap the campaigns flagged as budget waste and reallocate spend to top converters.');
  } else {
    recommendations.push('No major budget waste detected; keep current budget distribution and test new creatives incrementally.');
  }

  if (dbSignals.available && dbSignals.rows.length > 0) {
    const weakReply = dbSignals.rows.find((r) => pct(r.replied, r.contacted || r.total) < 30);
    if (weakReply) {
      recommendations.push(`Improve response handling for source ${weakReply.source}: reply rate is below 30%, review first message and SLA.`);
    }
  }

  // Fetch Google Ads data (optional)
  let googleAdsCampaigns = null;
  if (googleServiceAccount) {
    try {
      const gResults = await fetchGoogleAdsInsights({
        devToken: gDevToken,
        customerId: gCustomerId,
        serviceAccount: googleServiceAccount,
        since,
        until,
      });
      googleAdsCampaigns = summariseGoogleAds(gResults);
      console.log(`[meta-daily-report] Google Ads: ${googleAdsCampaigns.length} campaigns fetched`);
    } catch (e) {
      console.warn(`[meta-daily-report] Google Ads fetch failed: ${e.message}`);
    }
  }

  const markdown = buildMarkdown({
    generatedAt: new Date().toISOString(),
    period: { since, until },
    account: adAccountId,
    totals,
    channels,
    campaigns: { best: bestCampaigns, waste: wasteCampaigns },
    landing,
    dbSignals,
    googleAdsCampaigns,
    recommendations,
  });

  const reportsDir = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `meta-weekly-report-${until}.md`);
  fs.writeFileSync(reportPath, markdown, 'utf8');

  let agentOutputId = null;
  try {
    agentOutputId = await maybePersistOutput({
      databaseUrl,
      reportUserId,
      clinicId,
      markdown,
      metadata: {
        source: 'daily_ads_workflow',
        ad_account_id: adAccountId,
        google_customer_id: gCustomerId || null,
        since,
        until,
      },
    });
  } catch (err) {
    console.warn(`[meta-daily-report] Could not persist to agent_outputs: ${err.message}`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  console.log('[meta-daily-report] Report generated successfully');
  console.log(`[meta-daily-report] File: ${reportPath}`);
  if (agentOutputId) {
    console.log(`[meta-daily-report] Persisted agent_outputs.id: ${agentOutputId}`);
  }
}

main().catch((err) => {
  console.error('[meta-daily-report] Fatal:', err.message);
  process.exit(1);
});
