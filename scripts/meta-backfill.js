#!/usr/bin/env node
/**
 * meta-backfill.js
 * Back-fills meta_daily_insights from the Meta Insights API for a configurable
 * number of past days (default 90). Run once after initial setup or whenever
 * the table is empty/stale.
 *
 * Required env vars:
 *   META_ACCESS_TOKEN   — Meta System User access token (never-expiring)
 *   META_AD_ACCOUNT_ID  — e.g. "act_123456789"
 *   DATABASE_URL        — Postgres connection string
 *
 * Optional:
 *   REPORT_USER_ID      — UUID of the user row in public.users.
 *                         If omitted, the script auto-discovers the user whose
 *                         Meta integration matches META_AD_ACCOUNT_ID.
 *   META_APP_SECRET     — if set, adds appsecret_proof to all requests
 *   BACKFILL_DAYS       — number of days to back-fill (default 90, max 365)
 *   BACKFILL_SINCE      — explicit start date YYYY-MM-DD (overrides BACKFILL_DAYS)
 *   BACKFILL_UNTIL      — explicit end date YYYY-MM-DD (default: yesterday)
 */

'use strict';

const { Client } = require('pg');
const crypto     = require('node:crypto');

const META_GRAPH = 'https://graph.facebook.com/v22.0';

const {
  META_ACCESS_TOKEN: token,
  META_AD_ACCOUNT_ID: rawAccount,
  META_AD_ACCOUNT_IDS: rawAccountsEnv,
  META_APP_SECRET:    appSecret,
  DATABASE_URL:       databaseUrl,
  REPORT_USER_ID:     reportUserIdEnv,
} = process.env;

const parsedBackfillDays = Number.parseInt(process.env.BACKFILL_DAYS || '90', 10);
const BACKFILL_DAYS = Number.isFinite(parsedBackfillDays) && parsedBackfillDays > 0
  ? Math.min(parsedBackfillDays, 365)
  : 90;

function normalizeAdAccountId(raw) {
  if (raw === undefined || raw === null) return '';
  let value = String(raw).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return '';
  if (!value.startsWith('act_')) value = `act_${value}`;
  const numericId = value.replace(/^act_/, '');
  return numericId && /^\d+$/.test(numericId) ? `act_${numericId}` : '';
}

function normalizeAdAccountIds(raw) {
  if (Array.isArray(raw)) return raw.flatMap((item) => normalizeAdAccountIds(item));
  if (raw === undefined || raw === null) return [];
  const value = String(raw).trim();
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map(normalizeAdAccountId)
    .filter(Boolean);
}

const rawAccounts = rawAccountsEnv ?? rawAccount;
const adAccountIds = normalizeAdAccountIds(rawAccounts);

// ─── Validation ─────────────────────────────────────────────────────────────
if (!token || adAccountIds.length === 0 || !databaseUrl) {
  console.error('[meta-backfill] Missing required env vars.');
  console.error('  Required: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID or META_AD_ACCOUNT_IDS, DATABASE_URL');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function metaFetch(endpoint, params, attempt = 1) {
  const url = new URL(`${META_GRAPH}${endpoint}`);
  url.searchParams.set('access_token', token);

  if (appSecret) {
    const proof = crypto.createHmac('sha256', appSecret).update(token).digest('hex');
    url.searchParams.set('appsecret_proof', proof);
  }

  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
    const data = await response.json();

    if (!response.ok) {
      const error   = data?.error ?? {};
      const msg     = error.message   ?? `Meta API ${response.status}`;
      const code    = error.code      ?? 'unknown';
      const subcode = error.error_subcode ?? 'unknown';
      const fullMsg = `[Meta Error] Code: ${code}, Subcode: ${subcode}, Message: ${msg}`;

      const isTransient =
        [429, 500, 502, 503, 504].includes(response.status) ||
        String(msg).toLowerCase().includes('throttl') ||
        String(msg).toLowerCase().includes('rate limit') ||
        [4, 17, 613, 800].includes(Number(code));

      if (attempt < 4 && isTransient) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        console.warn(`[meta-backfill] Transient error on attempt ${attempt}, retrying in ${backoffMs}ms: ${msg}`);
        await sleep(backoffMs);
        return metaFetch(endpoint, params, attempt + 1);
      }
      throw new Error(fullMsg);
    }
    return data;
  } catch (err) {
    const isTimeout = String(err?.message ?? '').toLowerCase().includes('timeout');
    if (attempt < 4 && isTimeout) {
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      console.warn(`[meta-backfill] Timeout on attempt ${attempt}, retrying in ${backoffMs}ms`);
      await sleep(backoffMs);
      return metaFetch(endpoint, params, attempt + 1);
    }
    throw err;
  }
}

function getAction(actions, type) {
  return Number((actions ?? []).find((a) => a.action_type === type)?.value ?? 0);
}

function toYMD(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function assertYMD(label, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD, got: ${JSON.stringify(value)}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/** Resolve the user_id: use env var if given, otherwise auto-discover from integrations table. */
async function resolveReportUserId(db) {
  if (reportUserIdEnv) return reportUserIdEnv;

  const conditions = adAccountIds.map((_, index) => `(
      metadata->>'adAccountId' = $${index * 2 + 1}
      OR metadata->>'ad_account_id' = $${index * 2 + 1}
      OR metadata->>'adAccountIds' LIKE $${index * 2 + 2}
      OR metadata->>'ad_account_ids' LIKE $${index * 2 + 2}
    )`).join(' OR ');

  const params = adAccountIds.flatMap((id) => [id, `%${id}%`]);
  const { rows: intRows } = await db.query(
    `SELECT user_id FROM public.integrations
     WHERE service = 'meta'
       AND (${conditions})
     LIMIT 1`,
    params
  );

  if (intRows.length > 0) {
    console.log('[meta-backfill] Auto-discovered REPORT_USER_ID from integrations table.');
    return intRows[0].user_id;
  }

  // Fallback: any user with a meta integration
  const { rows: fallbackRows } = await db.query(
    `SELECT user_id FROM public.integrations WHERE service = 'meta' LIMIT 1`
  );
  if (fallbackRows.length > 0) {
    console.log('[meta-backfill] Auto-discovered REPORT_USER_ID (fallback: first meta integration).');
    return fallbackRows[0].user_id;
  }

  throw new Error(
    'Cannot determine REPORT_USER_ID: no Meta integration found in DB and REPORT_USER_ID env var is not set.'
  );
}

async function main() {
  const argv = process.argv.slice(2);
  // Trim to handle GitHub Actions passing empty-string '' for unset inputs.
  // Use || (not ??) so that empty strings fall through to the computed default.
  const argSince = (argv.find((a) => a.startsWith('--since='))?.split('=')[1] ?? process.env.BACKFILL_SINCE ?? '').trim();
  const argUntil = (argv.find((a) => a.startsWith('--until='))?.split('=')[1] ?? process.env.BACKFILL_UNTIL ?? '').trim();

  const today     = new Date();
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));

  const until = argUntil || toYMD(yesterday);
  assertYMD('BACKFILL_UNTIL', until);

  const startDate = new Date(`${until}T00:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - BACKFILL_DAYS);
  const since = argSince || toYMD(startDate);
  assertYMD('BACKFILL_SINCE', since);

  console.log(`[meta-backfill] Fetching account-level daily insights: ${since} → ${until}`);
  const maskedAccounts = adAccountIds.map((id) => id.replaceAll(/.(?=.{4})/g, '*')).join(', ');
  console.log(`[meta-backfill] Ad Accounts: ${maskedAccounts}`);

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  let reportUserId;
  try {
    reportUserId = await resolveReportUserId(db);
  } catch (err) {
    await db.end();
    throw err;
  }

  let totalUpserted = 0;
  let firstError = null;

  for (const adAccountId of adAccountIds) {
    try {
      console.log(`[meta-backfill] Fetching account-level daily insights for ${adAccountId}: ${since} → ${until}`);
      const data = await metaFetch(`/${adAccountId}/insights`, {
        fields: 'date_start,impressions,reach,clicks,spend,conversions,ctr,cpc,cpm,actions',
        time_range: JSON.stringify({ since, until }),
        time_increment: '1',
        level: 'account',
        limit: '1000',
      });

      const rows = Array.isArray(data?.data) ? data.data : [];
      console.log(`[meta-backfill] Received ${rows.length} daily rows from Meta for ${adAccountId}`);

      if (rows.length === 0) {
        console.log('[meta-backfill] No data returned — nothing to persist.');
        continue;
      }

      const upsertRows = rows.map((row) => ({
        user_id:                 reportUserId,
        ad_account_id:           adAccountId,
        date:                    row.date_start,
        impressions:             Number(row.impressions ?? 0),
        reach:                   Number(row.reach ?? 0),
        clicks:                  Number(row.clicks ?? 0),
        spend:                   Number(row.spend ?? 0),
        conversions:             Number(row.conversions ?? getAction(row.actions, 'lead') ?? 0),
        ctr:                     Number(row.ctr ?? 0),
        cpc:                     Number(row.cpc ?? 0),
        cpm:                     Number(row.cpm ?? 0),
        messaging_conversations: getAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d'),
        updated_at:              new Date().toISOString(),
      }));

      for (const r of upsertRows) {
        await db.query(`
          INSERT INTO public.meta_daily_insights
            (user_id, ad_account_id, date, impressions, reach, clicks, spend,
             conversions, ctr, cpc, cpm, messaging_conversations, updated_at)
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
        `, [r.user_id, r.ad_account_id, r.date, r.impressions, r.reach, r.clicks,
            r.spend, r.conversions, r.ctr, r.cpc, r.cpm, r.messaging_conversations, r.updated_at]);
        totalUpserted++;
      }
      console.log(`[meta-backfill] ✓ Upserted ${upsertRows.length} rows into meta_daily_insights for ${adAccountId}`);
    } catch (err) {
      console.error(`[meta-backfill] Failed to backfill ${adAccountId}:`, err.message ?? err);
      firstError = firstError || err;
    }
  }

  await db.end();

  if (firstError) {
    throw firstError;
  }
  console.log(`[meta-backfill] ✓ Upserted ${totalUpserted} rows into meta_daily_insights`);
}

main().catch((err) => {
  console.error('[meta-backfill] Fatal:', err.message);
  process.exit(1);
});
