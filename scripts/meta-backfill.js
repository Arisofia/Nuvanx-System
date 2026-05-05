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

const rawAccounts = rawAccount || rawAccountsEnv;
const adAccountIds = normalizeAdAccountIds(rawAccounts);

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

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

async function metaFetch(endpoint, accessTokenOverride, attempt = 1, params = {}) {
  const url = new URL(`${META_GRAPH}${endpoint}`);
  const accessToken = accessTokenOverride || token;
  url.searchParams.set('access_token', accessToken);

  if (appSecret) {
    const proof = crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
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
        return metaFetch(endpoint, accessTokenOverride, attempt + 1, params);
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
      return metaFetch(endpoint, accessTokenOverride, attempt + 1, params);
    }
    throw err;
  }
}

function getAction(actions, type) {
  return Number((actions ?? []).find((a) => a.action_type === type)?.value ?? 0);
}

function isYyyyMmDd(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseYyyyMmDd(value, label) {
  if (!value) return null;
  if (!isYyyyMmDd(value)) {
    throw new Error(`[meta-backfill] ${label} must be YYYY-MM-DD; got: ${JSON.stringify(value)}`);
  }
  return new Date(`${value}T00:00:00Z`);
}

function toYyyyMmDd(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return d.toISOString().slice(0, 10);
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
    `SELECT user_id, metadata->>'pageId' AS page_id, metadata->>'page_id' AS page_id_alt
     FROM public.integrations
     WHERE service = 'meta'
       AND (${conditions})
     ORDER BY (metadata->>'pageId' IS NOT NULL AND metadata->>'pageId' <> '') DESC,
              (metadata->>'page_id' IS NOT NULL AND metadata->>'page_id' <> '') DESC
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

async function resolveMetaPageId(db, userId) {
  if (process.env.META_PAGE_ID) return process.env.META_PAGE_ID;

  const { rows } = await db.query(
    `SELECT metadata->>'pageId' AS page_id,
            metadata->>'page_id' AS page_id_alt
     FROM public.integrations
     WHERE service = 'meta'
       AND user_id = $1
     LIMIT 1`,
    [userId]
  );
  const row = rows[0] || {};
  return row.page_id || row.page_id_alt || null;
}

async function resolvePageAccessToken(pageId) {
  const url = new URL(`${META_GRAPH}/me/accounts`);
  url.searchParams.set('access_token', token);
  if (appSecret) {
    const proof = crypto.createHmac('sha256', appSecret).update(token).digest('hex');
    url.searchParams.set('appsecret_proof', proof);
  }
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '50');

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`[Meta Error] ${data?.error?.message ?? response.statusText}`);
  }

  const page = data?.data?.find?.((item) => String(item.id) === String(pageId));
  if (!page || !page.access_token) {
    throw new Error(`Page access token not found for Page ID ${pageId}`);
  }
  return page.access_token;
}

async function main() {
  const argv = process.argv.slice(2);
  // Trim to handle GitHub Actions passing empty-string '' for unset inputs.
  // Use || (not ??) so that empty strings fall through to the computed default.
  const argSince = (argv.find((a) => a.startsWith('--since='))?.split('=')[1] ?? process.env.BACKFILL_SINCE ?? '').trim();
  const argUntil = (argv.find((a) => a.startsWith('--until='))?.split('=')[1] ?? process.env.BACKFILL_UNTIL ?? '').trim();

  const untilInput = parseYyyyMmDd(argUntil, 'BACKFILL_UNTIL') ?? parseYyyyMmDd(process.env.BACKFILL_UNTIL, 'BACKFILL_UNTIL');
  const sinceInput = parseYyyyMmDd(argSince, 'BACKFILL_SINCE') ?? parseYyyyMmDd(process.env.BACKFILL_SINCE, 'BACKFILL_SINCE');

  const today = new Date();
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));

  const untilDate = untilInput ?? yesterday;
  const sinceDate = sinceInput ?? new Date(Date.UTC(untilDate.getUTCFullYear(), untilDate.getUTCMonth(), untilDate.getUTCDate() - (BACKFILL_DAYS - 1)));

  const until = toYyyyMmDd(untilDate);
  const since = toYyyyMmDd(sinceDate);

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
      const data = await metaFetch(
        `/${adAccountId}/insights`,
        undefined,
        1,
        {
          fields: 'date_start,impressions,reach,clicks,spend,conversions,ctr,cpc,cpm,actions',
          time_range: JSON.stringify({ since, until }),
          time_increment: '1',
          level: 'account',
          limit: '1000',
        }
      );

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
        impressions:             safeNumber(row.impressions),
        reach:                   safeNumber(row.reach),
        clicks:                  safeNumber(row.clicks),
        spend:                   safeNumber(row.spend),
        conversions:             safeNumber(row.conversions ?? getAction(row.actions, 'lead') ?? 0),
        ctr:                     safeNumber(row.ctr),
        cpc:                     safeNumber(row.cpc),
        cpm:                     safeNumber(row.cpm),
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

      const sinceTs = Math.floor(new Date(`${since}T00:00:00Z`).getTime() / 1000);
      const leadRows = await ingestMetaLeadsFromForms(db, reportUserId, adAccountId, sinceTs);
      console.log(`[meta-backfill] ✓ Ingested ${leadRows} leads into public.leads for ${adAccountId}`);
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

async function ingestMetaLeadsFromForms(db, userId, adAccountId, sinceTs) {
  let totalFetched = 0;
  const pageId = await resolveMetaPageId(db, userId);
  if (!pageId) {
    console.warn('[meta-backfill] No META_PAGE_ID configured and no pageId found in integrations metadata. Skipping lead ingestion.');
    return 0;
  }
  const pageToken = await resolvePageAccessToken(pageId);
  const formsRes = await metaFetch(
    `/${pageId}/leadgen_forms`,
    pageToken,
    1,
    {
      fields: 'id,name',
      limit: '50',
    }
  );

  for (const form of (formsRes?.data ?? [])) {
    try {
      const leadsRes = await metaFetch(
        `/${form.id}/leads`,
        pageToken,
        1,
        {
          fields: 'id,field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,page_id',
          filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceTs }]),
          limit: '500',
        }
      );

      for (const leadData of (leadsRes?.data ?? [])) {
        try {
          const success = await processLeadData(db, userId, leadData);
          if (success) totalFetched++;
        } catch (leadError) {
          console.warn(`[meta-backfill] Skipping lead ${leadData?.id ?? '(unknown)'} from form ${form?.id}:`, leadError?.message ?? leadError);
        }
      }
    } catch (formError) {
      console.warn(`[meta-backfill] Meta lead ingestion failed for form ${form?.id}:`, formError?.message ?? formError);
    }
  }

  return totalFetched;
}

function resolveLeadName(fields, leadgen_id) {
  const firstName = fields['first_name'] ?? fields['nombre'] ?? fields['nombre1'] ?? '';
  const lastName = fields['last_name'] ?? fields['apellido'] ?? fields['apellidos'] ?? '';
  const explicitName = fields['full_name'] ?? fields['nombre_completo'] ?? fields['nombre'] ?? fields['name'] ?? '';

  if (explicitName) return explicitName;
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return `Lead ${leadgen_id.slice(-6)}`;
}

function extractMetaLeadCustomerInfo(fieldData) {
  return (Array.isArray(fieldData) ? fieldData : []).reduce((acc, item) => {
    const key = String(item?.name ?? item?.field_name ?? item?.key ?? '').trim();
    if (!key) return acc;
    let value = '';
    if (Array.isArray(item?.values) && item.values.length > 0) {
      value = String(item.values[0] ?? '').trim();
    } else if (item?.value !== undefined && item?.value !== null) {
      value = String(item.value).trim();
    }
    if (value) acc[key] = value;
    return acc;
  }, {});
}

function classifyMetaLeadTag(fields) {
  const normalized = Object.values(fields).join(' ').toLowerCase();
  return normalized.includes('botox') ? 'neuromodulador/botox' : 'general';
}

async function processLeadData(db, userId, leadData) {
  const fields = {};
  for (const f of (leadData.field_data ?? [])) {
    fields[(f.name ?? '').toLowerCase()] = f.values?.[0] ?? '';
  }

  const leadDataFields = extractMetaLeadCustomerInfo(leadData.field_data ?? []);
  const tag = classifyMetaLeadTag(leadDataFields);

  const leadgen_id = leadData.id;
  const leadName = resolveLeadName(fields, leadgen_id);
  const email = fields['email'] ?? null;
  const phone = fields['phone_number'] ?? fields['telefono'] ?? fields['phone'] ?? null;
  const dni = fields['dni'] ?? fields['nif'] ?? fields['national_id'] ?? null;

  const KNOWN_STANDARD = new Set([
    'full_name', 'nombre_completo', 'nombre', 'name', 'first_name', 'last_name',
    'email', 'phone_number', 'telefono', 'phone', 'dni', 'nif', 'national_id',
  ]);
  const customFields = Object.fromEntries(
    Object.entries(fields).filter(([k]) => !KNOWN_STANDARD.has(k))
  );
  if (tag !== 'general') {
    customFields.meta_tag = tag;
  }
  const notes = Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null;

  const HIGH_PRIORITY_KEYWORDS = /botox|bótox|neuromodulador|toxina\s*botulínica|botulínica|relleno|hialu|hialurón|rinomodelación|bichectomía|lifting/i;
  const allValues = Object.values(fields).join(' ') + ' ' + (notes ?? '');
  const priority = HIGH_PRIORITY_KEYWORDS.test(allValues) ? 'high' : 'normal';

  let createdAt;
  try {
    const rawTime = leadData.created_time;
    if (!rawTime) {
      createdAt = new Date().toISOString();
    } else if (typeof rawTime === 'number') {
      createdAt = new Date(rawTime * 1000).toISOString();
    } else if (typeof rawTime === 'string' && /^\d+$/.test(rawTime)) {
      createdAt = new Date(Number(rawTime) * 1000).toISOString();
    } else {
      const d = new Date(rawTime);
      createdAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
  } catch {
    createdAt = new Date().toISOString();
  }

  const { rows: existingLeadRows } = await db.query(
    `SELECT id FROM public.leads WHERE user_id = $1 AND source = 'meta_leadgen' AND external_id = $2 LIMIT 1`,
    [userId, leadgen_id]
  );
  if (existingLeadRows.length > 0) {
    return false;
  }

  const leadResult = await db.query(`
    INSERT INTO public.leads
      (user_id, external_id, source, name, email, phone, dni, notes, priority,
       stage, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
       form_id, form_name, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING id
  `, [
    userId,
    leadgen_id,
    'meta_leadgen',
    leadName,
    email,
    phone,
    dni || null,
    notes || null,
    priority,
    'lead',
    leadData.campaign_id ?? null,
    leadData.campaign_name ?? null,
    leadData.adset_id ?? null,
    leadData.adset_name ?? null,
    leadData.ad_id ?? null,
    leadData.ad_name ?? null,
    leadData.form_id ?? null,
    leadData.form_name ?? null,
    createdAt,
  ]);

  const insertedLead = leadResult?.rows?.[0]?.id;
  if (insertedLead) {
    await db.query(`
      DELETE FROM public.meta_attribution
       WHERE leadgen_id = $1
    `, [leadgen_id]);

    await db.query(`
      INSERT INTO public.meta_attribution
        (lead_id, leadgen_id, page_id, form_id, campaign_id, campaign_name,
         adset_id, adset_name, ad_id, ad_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      insertedLead,
      leadgen_id,
      leadData.page_id ?? null,
      leadData.form_id ?? null,
      leadData.campaign_id ?? null,
      leadData.campaign_name ?? null,
      leadData.adset_id ?? null,
      leadData.adset_name ?? null,
      leadData.ad_id ?? null,
      leadData.ad_name ?? null,
    ]);
    return true;
  }
  return false;
}

main().catch((err) => {
  console.error('[meta-backfill] Fatal:', err.message);
  process.exit(1);
});
