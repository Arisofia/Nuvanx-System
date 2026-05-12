#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const META_GRAPH = 'https://graph.facebook.com/v22.0';
const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v17';

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeAdAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replaceAll(/\D/g, '');
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
    return raw.reduce((sum, item) => sum + parseMetric(item && Object.hasOwn(item, 'value') ? item.value : item), 0);
  }
  if (typeof raw === 'object' && Object.hasOwn(raw, 'value')) {
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

function getAction(type, actions = []) {
  return Number((actions || []).find((a) => a?.action_type === type)?.value || 0);
}

function getWhatsApp(actions = []) {
  return actionValue(actions, isWhatsAppAction);
}

function getLeadForm(actions = []) {
  return actionValue(actions, isLeadFormAction);
}

function isWhatsAppAction(type) {
  return type.includes('whatsapp')
      || type.includes('messaging')
      || type.includes('conversation_started')
      || type === 'onsite_conversion.messaging_conversation_started_7d';
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

function parseRelativeDate(value, referenceDate = new Date()) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'today') return new Date(referenceDate);
  if (normalized === 'yesterday') {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  const rel = /^(\d+)d$/.exec(normalized);
  if (rel) {
    const days = Number(rel[1]);
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  }
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  return null;
}

function getGoogleServiceAccount(gServiceAccountRaw, gDevToken, gCustomerId) {
  if (!gServiceAccountRaw || !gDevToken || !gCustomerId) return null;

  try {
    const raw = gServiceAccountRaw.startsWith('{') ? gServiceAccountRaw : Buffer.from(gServiceAccountRaw, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch {
    console.warn('[meta-daily-report] Invalid GOOGLE_ADS_SERVICE_ACCOUNT — skipping Google Ads section');
    return null;
  }
}

function getPrimaryChannel(waLeads, formLeads) {
  if (waLeads > formLeads) return 'WhatsApp';
  if (formLeads > waLeads) return 'Lead Form';
  return 'Mixed/Unknown';
}

function buildCampaignRows(rows) {
  return (rows || []).map((row) => {
    const spend = parseMetric(row.spend);
    const impressions = parseMetric(row.impressions);
    const clicks = parseMetric(row.clicks || row.inline_link_clicks || row.outbound_clicks);
    const landingPageViews = parseMetric(row.landing_page_views || row.landing_page_view);
    const waLeads = getWhatsApp(row.actions);
    const formLeads = getLeadForm(row.actions);
    const totalLeads = waLeads + formLeads;

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
      primaryChannel: getPrimaryChannel(waLeads, formLeads),
      cpl: totalLeads > 0 ? spend / totalLeads : 0,
      isWaste: spend > 0 && totalLeads === 0,
    };
  });
}

// ── Google Ads helpers ───────────────────────────────────────────────────────

function b64url(data) {
  const buf = Buffer.from(data);
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
  const cleanId = customerId.replaceAll('-', '');
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

// ─── Meta fetch ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function metaFetch(endpoint, params, token, attempt = 1) {
  const url = new URL(`${META_GRAPH}${endpoint}`);
  url.searchParams.set('access_token', token);

  // Add appsecret_proof when META_APP_SECRET is configured.
  // Meta requires this for System User tokens when the app has
  // "Require App Secret" enabled in Advanced Settings.
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    const proof = crypto.createHmac('sha256', appSecret).update(token).digest('hex');
    url.searchParams.set('appsecret_proof', proof);
  }

  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
    const data = await response.json();

    if (!response.ok) {
      const error = data?.error || {};
      const msg = error.message || `Meta API ${response.status}`;
      const code = error.code || 'unknown';
      const subcode = error.error_subcode || 'unknown';
      const traceId = error.fbtrace_id || 'unknown';

      const fullErrorMsg = `[Meta Error] Code: ${code}, Subcode: ${subcode}, Message: ${msg} (trace_id: ${traceId})`;
      const isTransient = [429, 500, 502, 503, 504].includes(response.status)
        || String(msg).toLowerCase().includes('throttl')
        || String(msg).toLowerCase().includes('rate limit')
        || [4, 17, 613, 800].includes(Number(code));

      if (attempt < 3 && isTransient) {
        const backoffMs = 500 * Math.pow(2, attempt - 1);
        console.warn(`[meta-daily-report] Transient Meta error on attempt ${attempt}: ${msg}. Retrying after ${backoffMs}ms.`);
        await sleep(backoffMs);
        return metaFetch(endpoint, params, token, attempt + 1);
      }

      if (
        msg.includes('user logged out') ||
        msg.includes('session is invalid') ||
        msg.includes('Invalid OAuth access token') ||
        msg.includes('token has expired')
      ) {
        throw new Error(
          `META_ACCESS_TOKEN is a user-session token that has been invalidated. ` +
          `Use a Meta System User access token instead: ` +
          `Business Settings → Users → System Users → generate a token with ads_read / ads_management scopes. ` +
          `Update the META_ACCESS_TOKEN secret in GitHub → Settings → Secrets → Actions. ` +
          `Original error: ${fullErrorMsg}`,
        );
      }
      throw new Error(fullErrorMsg);
    }

    return data;
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    const isTimeout = message.includes('timeout') || message.includes('aborted') || message.includes('networkerror');
    if (attempt < 3 && isTimeout) {
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      console.warn(`[meta-daily-report] Meta fetch timeout on attempt ${attempt}. Retrying after ${backoffMs}ms.`);
      await sleep(backoffMs);
      return metaFetch(endpoint, params, token, attempt + 1);
    }
    throw err;
  }
}

async function metaFetchWithFallback(endpoint, params, token) {
  try {
    return await metaFetch(endpoint, params, token);
  } catch (err) {
    const msg = String(err?.message || '').toLowerCase();
    if (
      params?.filtering && (
        msg.includes('invalid keys "values" were found in param "filtering[0]"') ||
        msg.includes('filtering field effective_status is invalid') ||
        msg.includes('invalid field effective_status') ||
        msg.includes('filtering field')
      )
    ) {
      console.warn('[meta-daily-report] Meta filtering failed; retrying without filtering');
      const fallbackParams = { ...params };
      delete fallbackParams.filtering;
      return await metaFetch(endpoint, fallbackParams, token);
    }
    throw err;
  }
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

async function persistMetaDailyInsights({ databaseUrl, reportUserId, adAccountId, since, until, token }) {
  if (!databaseUrl || !reportUserId) return null;

  // Fetch account-level daily insights with time_increment=1
  const insights = await metaFetch(`/${adAccountId}/insights`, {
    fields: 'date_start,impressions,reach,clicks,spend,conversions,ctr,cpc,cpm,actions',
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    level: 'account',
    limit: '1000',
  }, token);

  const rows = Array.isArray(insights?.data) ? insights.data : [];
  if (rows.length === 0) return null;

  const getAction = (actions, type) =>
    Number((actions || []).find((a) => a.action_type === type)?.value ?? 0);

  const upsertRows = rows.map((row) => ({
    user_id: reportUserId,
    ad_account_id: adAccountId,
    date: row.date_start,
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    clicks: Number(row.clicks ?? 0),
    spend: Number(row.spend ?? 0),
    conversions: Number(row.conversions ?? getAction(row.actions, 'lead') ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.cpc ?? 0),
    cpm: Number(row.cpm ?? 0),
    messaging_conversations: getAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d'),
    updated_at: new Date().toISOString(),
  }));

  const { Client } = require('pg');
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    for (const r of upsertRows) {
      await db.query(`
        INSERT INTO public.meta_daily_insights
          (user_id, ad_account_id, date, impressions, reach, clicks, spend, conversions, ctr, cpc, cpm, messaging_conversations, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (user_id, ad_account_id, date)
        DO UPDATE SET
          impressions             = EXCLUDED.impressions,
          reach                   = EXCLUDED.reach,
          clicks                  = EXCLUDED.clicks,
          spend                   = EXCLUDED.spend,
          conversions             = EXCLUDED.conversions,
          ctr                     = EXCLUDED.ctr,
          cpc                     = EXCLUDED.cpc,
          cpm                     = EXCLUDED.cpm,
          messaging_conversations = EXCLUDED.messaging_conversations,
          updated_at              = EXCLUDED.updated_at
      `, [r.user_id, r.ad_account_id, r.date, r.impressions, r.reach, r.clicks, r.spend, r.conversions, r.ctr, r.cpc, r.cpm, r.messaging_conversations, r.updated_at]);
    }
    console.log(`[meta-daily-report] Persisted ${upsertRows.length} rows to meta_daily_insights`);
    return upsertRows.length;
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

  const headerLines = [
    '## Google Ads — Campaign Summary',
    '',
    `- Total Spend: ${eur(gTotals.spend)}`,
    `- Total Clicks: ${numberFmt(gTotals.clicks)}`,
    `- Total Impressions: ${numberFmt(gTotals.impressions)}`,
    `- Conversions: ${numberFmt(gTotals.conversions)}`,
    '',
    '| Campaign | Spend | Clicks | Conversions | CTR |',
    '|---|---:|---:|---:|---:|',
  ];

  const campaignLines = campaigns.slice(0, 10).map((c) =>
    `| ${c.name} | ${eur(c.spend)} | ${numberFmt(c.clicks)} | ${numberFmt(c.conversions)} | ${c.ctr.toFixed(2)}% |`
  );

  return [...headerLines, ...campaignLines, ''].join('\n');
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
  const add = (...items) => lines.push(...items);

  add(
    '# Daily Unified Meta Ads Report',
    '',
    `- Generated at (UTC): ${generatedAt}`,
    `- Ad account: ${account}`,
    `- Window: ${period.since} to ${period.until}`,
    '',
    '## Executive Summary',
    '',
    `- Spend: ${eur(totals.spend)}`,
    `- Impressions: ${numberFmt(totals.impressions)}`,
    `- Clicks: ${numberFmt(totals.clicks)}`,
    `- CTR: ${totals.ctr.toFixed(2)}%`,
    `- CPC: ${eur(totals.cpc)}`,
    `- Estimated WhatsApp conversions: ${numberFmt(totals.whatsAppLeads)}`,
    `- Estimated Lead Form conversions: ${numberFmt(totals.formLeads)}`,
    '',
    '## Channel Comparison (WhatsApp vs Lead Forms)',
    '',
    '| Channel | Estimated Leads | Campaign Spend | Estimated CPL | Share of Leads |',
    '|---|---:|---:|---:|---:|',
    `| WhatsApp | ${numberFmt(channels.whatsapp.leads)} | ${eur(channels.whatsapp.spend)} | ${channels.whatsapp.cpl > 0 ? eur(channels.whatsapp.cpl) : 'n/a'} | ${channels.whatsapp.share.toFixed(1)}% |`,
    `| Lead Forms | ${numberFmt(channels.forms.leads)} | ${eur(channels.forms.spend)} | ${channels.forms.cpl > 0 ? eur(channels.forms.cpl) : 'n/a'} | ${channels.forms.share.toFixed(1)}% |`,
    '',
    '## Campaigns Performing Best (by estimated leads)',
    '',
    '| Campaign | Channel Focus | Spend | Leads | Estimated CPL |',
    '|---|---|---:|---:|---:|',
  );

  if (campaigns.best.length === 0) {
    add('| No campaign data | - | - | - | - |');
  } else {
    add(
      ...campaigns.best.map((row) =>
        `| ${row.name} | ${row.primaryChannel} | ${eur(row.spend)} | ${numberFmt(row.totalLeads)} | ${row.cpl > 0 ? eur(row.cpl) : 'n/a'} |`
      )
    );
  }

  add(
    '',
    '## Campaigns Wasting Budget (spend high, low/zero leads)',
    '',
    '| Campaign | Spend | Leads | Estimated CPL |',
    '|---|---:|---:|---:|',
  );

  if (campaigns.waste.length === 0) {
    add('| No clear budget waste detected for this window | - | - | - |');
  } else {
    add(
      ...campaigns.waste.map((row) =>
        `| ${row.name} | ${eur(row.spend)} | ${numberFmt(row.totalLeads)} | ${row.cpl > 0 ? eur(row.cpl) : 'n/a'} |`
      )
    );
  }

  add(
    '',
    '## Landing Funnel (click to landing view)',
    '',
    `- Outbound/Link clicks: ${numberFmt(landing.clicks)}`,
    `- Landing page views: ${numberFmt(landing.views)}`,
    `- Landing conversion rate: ${landing.rate.toFixed(1)}%`,
    '',
  );

  if (dbSignals.available) {
    add(
      '## CRM Response Funnel by Source (last 7 days)',
      '',
      '| Source | Leads | Contacted | Replied | Booked | Closed Won | Reply Rate | Booking Rate |',
      '|---|---:|---:|---:|---:|---:|---:|---:|',
    );

    if (dbSignals.rows.length === 0) {
      add('| No CRM leads found in this window | - | - | - | - | - | - | - |');
    } else {
      add(
        ...dbSignals.rows.map((row) => {
          const replyRate = pct(row.replied, row.contacted || row.total);
          const bookingRate = pct(row.booked, row.replied || row.total);
          return `| ${row.source} | ${row.total} | ${row.contacted} | ${row.replied} | ${row.booked} | ${row.closed_won} | ${replyRate.toFixed(1)}% | ${bookingRate.toFixed(1)}% |`;
        })
      );
    }

    add('');
  }

  const googleSection = buildGoogleAdsMarkdown(googleAdsCampaigns);
  if (googleSection) {
    add(googleSection);
  }

  add('## Recommended Actions for Next Day', '', ...recommendations.map((item, idx) => `${idx + 1}. ${item}`), '');

  return `${lines.join('\n')}\n`;
}

function getReportWindow(maybeSince, maybeUntil, days, utcToday) {
  const untilDate = parseRelativeDate(maybeUntil || 'today', utcToday) || utcToday;
  const sinceDate = parseRelativeDate(maybeSince || `${days}d`, untilDate) || new Date(untilDate);
  const since = formatDateUTC(sinceDate);
  const until = formatDateUTC(untilDate);
  const untilExclusive = formatDateUTC(new Date(untilDate.getTime() + 86400000));
  return { since, until, untilExclusive };
}

async function fetchMetaInsights(adAccountId, since, until, token) {
  const baseFields = [
    'campaign_id', 'campaign_name', 'impressions', 'clicks', 'spend',
    'ctr', 'cpc', 'cpm', 'actions', 'outbound_clicks', 'inline_link_clicks',
  ].join(',');

  try {
    const insights = await metaFetchWithFallback(`/${adAccountId}/insights`, {
      level: 'campaign',
      fields: baseFields,
      time_range: JSON.stringify({ since, until }),
      limit: '300',
      filtering: JSON.stringify([
        { field: 'campaign.status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'ARCHIVED'] },
      ]),
    }, token);
    return Array.isArray(insights?.data) ? insights.data : [];
  } catch (err) {
    // Emit a GitHub Actions error annotation so the run is marked as failed,
    // not just a silent zero-report that looks like a successful run.
    const msg = `Meta API call failed — report would be all zeros. ${err.message}`;
    if (process.env.GITHUB_ACTIONS) {
      process.stdout.write(`::error::${msg}\n`);
    } else {
      console.error(`[meta-daily-report] ${msg}`);
    }
    throw err;
  }
}

function calculateTotals(campaignRows) {
  const totals = campaignRows.reduce((acc, row) => {
    acc.spend += row.spend;
    acc.impressions += row.impressions;
    acc.clicks += row.clicks;
    acc.whatsAppLeads += row.waLeads;
    acc.formLeads += row.formLeads;
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, whatsAppLeads: 0, formLeads: 0 });

  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  return totals;
}

function calculateChannelStats(campaignRows, totals) {
  const channelLeadTotal = totals.whatsAppLeads + totals.formLeads;
  const whatsappSpend = campaignRows
    .filter((r) => r.primaryChannel === 'WhatsApp')
    .reduce((sum, r) => sum + r.spend, 0);
  const formsSpend = campaignRows
    .filter((r) => r.primaryChannel === 'Lead Form')
    .reduce((sum, r) => sum + r.spend, 0);

  return {
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
}

function generateRecommendations(channels, landing, wasteCampaigns, dbSignals) {
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
  return recommendations;
}

async function main() {
  const token = process.env.META_ACCESS_TOKEN;
  const rawAccount = process.env.META_AD_ACCOUNT_ID;
  const databaseUrl = process.env.DATABASE_URL || '';
  const clinicId = process.env.CLINIC_ID || '';
  const reportUserId = process.env.REPORT_USER_ID || '';

  const gServiceAccountRaw = process.env.GOOGLE_ADS_SERVICE_ACCOUNT || '';
  const gDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  const gCustomerId = process.env.GOOGLE_ADS_CUSTOMER_ID || '';
  const googleServiceAccount = getGoogleServiceAccount(gServiceAccountRaw, gDevToken, gCustomerId);

  if (!token || !rawAccount) {
    throw new Error('META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required');
  }

  const adAccountId = normalizeAdAccountId(rawAccount);
  if (!adAccountId) {
    throw new Error('META_AD_ACCOUNT_ID has invalid format');
  }

  const argv = process.argv.slice(2);
  const maybeSince = argv.find((arg) => arg.startsWith('--since='))?.split('=')[1];
  const maybeUntil = argv.find((arg) => arg.startsWith('--until='))?.split('=')[1];
  const days = Number.parseInt(process.env.REPORT_DAYS || '30', 10);

  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const { since, until, untilExclusive } = getReportWindow(maybeSince, maybeUntil, days, utcToday);

  const rows = await fetchMetaInsights(adAccountId, since, until, token);
  const campaignRows = buildCampaignRows(rows);
  const totals = calculateTotals(campaignRows);
  const channels = calculateChannelStats(campaignRows, totals);

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

  let dbSignals = { available: false, rows: [] };
  try {
    dbSignals = await maybeLoadDbSignals({
      databaseUrl, clinicId, sinceIso: since, untilExclusiveIso: untilExclusive,
    });
  } catch (err) {
    console.warn(`[meta-daily-report] Could not load CRM signals (DB): ${err.message}`);
  }

  const recommendations = generateRecommendations(channels, landing, wasteCampaigns, dbSignals);

  let googleAdsCampaigns = null;
  if (googleServiceAccount) {
    try {
      const gResults = await fetchGoogleAdsInsights({
        devToken: gDevToken, customerId: gCustomerId, serviceAccount: googleServiceAccount, since, until,
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
  const reportPath = path.join(reportsDir, `meta-daily-report-${until}.md`);
  fs.writeFileSync(reportPath, markdown, 'utf8');

  try {
    await maybePersistOutput({
      databaseUrl,
      reportUserId,
      clinicId,
      markdown,
      metadata: {
        source: 'daily_ads_workflow', ad_account_id: adAccountId, google_customer_id: gCustomerId || null, since, until,
      },
    });
  } catch (err) {
    console.warn(`[meta-daily-report] Could not persist to agent_outputs: ${err.message}`);
  }

  // Persist daily insights to meta_daily_insights for /kpis fallback
  if (databaseUrl && reportUserId) {
    try {
      await persistMetaDailyInsights({ databaseUrl, reportUserId, adAccountId, since, until, token });
    } catch (err) {
      console.warn(`[meta-daily-report] Could not persist to meta_daily_insights: ${err.message}`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  console.log('[meta-daily-report] Report generated successfully');
  console.log(`[meta-daily-report] File: ${reportPath}`);
}

main().catch((err) => {
  console.error('[meta-daily-report] Fatal:', err.message);
  process.exit(1);
});
