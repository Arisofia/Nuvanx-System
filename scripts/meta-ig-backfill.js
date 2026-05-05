#!/usr/bin/env node
/**
 * meta-ig-backfill.js
 *
 * Back-fills meta_ig_account_daily (account-level daily metrics) and
 * meta_ig_media_performance (per-media lifetime metrics) from the
 * Instagram Graph API.
 *
 * Required env vars:
 *   META_ACCESS_TOKEN   — System User access token
 *   DATABASE_URL        — Postgres connection string
 *
 * Optional:
 *   META_APP_SECRET     — adds appsecret_proof (recommended)
 *   META_IG_ID          — Instagram Business Account Graph ID. If omitted,
 *                          auto-discovered from integrations.metadata.igBusinessAccountId
 *                          or via the page's instagram_business_account edge.
 *   META_PAGE_ID        — fallback for IG discovery (linked Page).
 *   REPORT_USER_ID      — UUID; if omitted, auto-discovered from integrations.
 *   BACKFILL_DAYS       — account-level lookback (default 90, max 365).
 *   MEDIA_LIMIT         — max media items to backfill (default 200).
 */

'use strict';

const { Client } = require('pg');
const crypto     = require('node:crypto');

const META_GRAPH = 'https://graph.facebook.com/v22.0';

const {
  META_ACCESS_TOKEN: token,
  META_APP_SECRET:   appSecret,
  META_IG_ID:        rawIgId,
  META_PAGE_ID:      rawPageId,
  DATABASE_URL:      databaseUrl,
  REPORT_USER_ID:    reportUserIdEnv,
} = process.env;

const BACKFILL_DAYS = Math.min(
  Math.max(Number.parseInt(process.env.BACKFILL_DAYS || '90', 10) || 90, 1),
  365
);
const MEDIA_LIMIT = Math.min(
  Math.max(Number.parseInt(process.env.MEDIA_LIMIT || '200', 10) || 200, 1),
  1000
);

const TIME_SERIES_METRICS = ['reach', 'follower_count'];
const TOTAL_VALUE_METRICS = ['profile_views', 'accounts_engaged', 'total_interactions', 'website_clicks', 'views'];
const MEDIA_METRICS = ['reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'views'];

if (!token || !databaseUrl) {
  console.error('[ig-backfill] Missing META_ACCESS_TOKEN or DATABASE_URL.');
  process.exit(1);
}

function appsecretProof(t) {
  if (!appSecret) return null;
  return crypto.createHmac('sha256', appSecret).update(t).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function metaFetch(endpoint, params, accessToken, attempt = 1) {
  const url = new URL(`${META_GRAPH}${endpoint}`);
  url.searchParams.set('access_token', accessToken);
  const proof = appsecretProof(accessToken);
  if (proof) url.searchParams.set('appsecret_proof', proof);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  try {
    const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    if (!res.ok) {
      const msg     = data?.error?.message ?? `Meta API ${res.status}`;
      const code    = data?.error?.code ?? 'unknown';
      const transient =
        [429, 500, 502, 503, 504].includes(res.status) ||
        /throttl|rate limit/i.test(String(msg)) ||
        [4, 17, 613, 800].includes(Number(code));
      if (attempt < 4 && transient) {
        await sleep(1000 * 2 ** (attempt - 1));
        return metaFetch(endpoint, params, accessToken, attempt + 1);
      }
      const err = new Error(`[Meta Error] code=${code} msg=${msg}`);
      err.metaCode = code;
      throw err;
    }
    return data;
  } catch (err) {
    if (attempt < 4 && /timeout/i.test(String(err?.message ?? ''))) {
      await sleep(1000 * 2 ** (attempt - 1));
      return metaFetch(endpoint, params, accessToken, attempt + 1);
    }
    throw err;
  }
}

function toYyyyMmDd(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

async function getPageAccessToken(pageId) {
  const data = await metaFetch('/me/accounts', { fields: 'id,access_token,tasks', limit: '100' }, token);
  const list = Array.isArray(data?.data) ? data.data : [];
  const match = list.find((p) => String(p.id) === String(pageId));
  if (!match?.access_token) {
    throw new Error(`Page ${pageId} has no access_token via /me/accounts.`);
  }
  return match.access_token;
}

async function discoverIgFromPage(pageToken, pageId) {
  const data = await metaFetch(`/${pageId}`, { fields: 'instagram_business_account' }, pageToken);
  const igId = data?.instagram_business_account?.id;
  if (!igId) throw new Error(`Page ${pageId} has no linked Instagram Business Account.`);
  return igId;
}

async function resolveReportUserId(db, igId) {
  if (reportUserIdEnv) return reportUserIdEnv;
  const { rows } = await db.query(
    `SELECT user_id FROM public.integrations
      WHERE service='meta'
        AND (metadata->>'igBusinessAccountId' = $1 OR metadata->>'ig_business_account_id' = $1)
      LIMIT 1`,
    [igId]
  );
  if (rows[0]?.user_id) return rows[0].user_id;
  const fb = await db.query(`SELECT user_id FROM public.integrations WHERE service='meta' LIMIT 1`);
  if (fb.rows[0]?.user_id) {
    console.log('[ig-backfill] Fallback REPORT_USER_ID = first meta integration.');
    return fb.rows[0].user_id;
  }
  throw new Error('Cannot resolve REPORT_USER_ID.');
}

async function resolveIgAndPage(db) {
  // 1. explicit env
  if (rawIgId && /^\d{6,}$/.test(String(rawIgId))) return { igId: String(rawIgId), pageId: rawPageId || null };

  // 2. integrations.metadata
  const { rows } = await db.query(
    `SELECT metadata FROM public.integrations WHERE service='meta' LIMIT 1`
  );
  const meta = rows[0]?.metadata || {};
  const igFromMeta = meta.igBusinessAccountId || meta.ig_business_account_id;
  if (igFromMeta) return { igId: String(igFromMeta), pageId: meta.pageId || meta.page_id || rawPageId || null };

  // 3. discover via page
  const pageId = meta.pageId || meta.page_id || rawPageId;
  if (!pageId) throw new Error('Cannot resolve IG ID: no META_IG_ID, no metadata.igBusinessAccountId, no pageId.');
  const pageToken = await getPageAccessToken(pageId);
  const igId = await discoverIgFromPage(pageToken, pageId);
  console.log(`[ig-backfill] Discovered IG ${igId} from page ${pageId}.`);
  return { igId, pageId };
}

function addTimeSeriesData(byDate, tsData) {
  for (const m of tsData?.data || []) {
    for (const v of m.values || []) {
      const day = (v.end_time || '').slice(0, 10);
      if (!day) continue;
      const row = byDate.get(day) || { day };
      row[m.name] = Number(v.value || 0);
      byDate.set(day, row);
    }
  }
}

async function fetchTimeSeriesInsights(igId, igToken, reqSince, reqUntil) {
  const params = {
    metric: TIME_SERIES_METRICS.join(','),
    period: 'day',
    metric_type: 'time_series',
    since: reqSince,
    until: reqUntil,
  };
  try {
    return await metaFetch(`/${igId}/insights`, params, igToken);
  } catch (err) {
    if (/follower_count/i.test(err.message)) {
      return await metaFetch(`/${igId}/insights`, {
        ...params,
        metric: TIME_SERIES_METRICS.filter((m) => m !== 'follower_count').join(','),
      }, igToken);
    }
    throw err;
  }
}

async function fetchTotalValueInsights(igId, igToken, dayStart, dayEnd) {
  return await metaFetch(`/${igId}/insights`, {
    metric: TOTAL_VALUE_METRICS.join(','),
    period: 'day',
    metric_type: 'total_value',
    since: dayStart,
    until: dayEnd,
  }, igToken);
}

function addTotalValueData(byDate, tvData, dayKey) {
  const row = byDate.get(dayKey) || { day: dayKey };
  for (const m of tvData?.data || []) {
    row[m.name] = Number(m.total_value?.value || 0);
  }
  byDate.set(dayKey, row);
}

async function upsertAccountDaily(db, userId, igId, row) {
  await db.query(
    `INSERT INTO public.meta_ig_account_daily
       (user_id, ig_id, date, reach, follower_count_delta, profile_views,
        accounts_engaged, total_interactions, website_clicks, views, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
     ON CONFLICT (user_id, ig_id, date) DO UPDATE SET
       reach                = EXCLUDED.reach,
       follower_count_delta = EXCLUDED.follower_count_delta,
       profile_views        = EXCLUDED.profile_views,
       accounts_engaged     = EXCLUDED.accounts_engaged,
       total_interactions   = EXCLUDED.total_interactions,
       website_clicks       = EXCLUDED.website_clicks,
       views                = EXCLUDED.views,
       updated_at           = NOW()`,
    [
      userId, igId, row.day,
      Number(row.reach || 0),
      Number(row.follower_count || 0),
      Number(row.profile_views || 0),
      Number(row.accounts_engaged || 0),
      Number(row.total_interactions || 0),
      Number(row.website_clicks || 0),
      Number(row.views || 0),
    ]
  );
}

async function backfillAccountDaily(db, userId, igId, igToken, since, until) {
  const byDate = new Map();
  const startMsAll = new Date(since + 'T00:00:00Z').getTime();
  const endMsAll   = new Date(until + 'T00:00:00Z').getTime();
  const chunkMs    = 29 * 24 * 3600 * 1000;

  for (let cs = startMsAll; cs <= endMsAll; cs += chunkMs + 24 * 3600 * 1000) {
    const ce = Math.min(cs + chunkMs, endMsAll);
    const reqSince = Math.floor(cs / 1000);
    const reqUntil = Math.floor((ce + 24 * 3600 * 1000 - 1) / 1000);
    const tsData = await fetchTimeSeriesInsights(igId, igToken, reqSince, reqUntil);
    addTimeSeriesData(byDate, tsData);
  }

  const startMs = new Date(since + 'T00:00:00Z').getTime();
  const endMs   = new Date(until + 'T00:00:00Z').getTime();
  for (let t = startMs; t <= endMs; t += 24 * 3600 * 1000) {
    const dayStart = Math.floor(t / 1000);
    const dayEnd   = Math.floor((t + 24 * 3600 * 1000) / 1000);
    const dayKey   = new Date(t).toISOString().slice(0, 10);
    try {
      const tvData = await fetchTotalValueInsights(igId, igToken, dayStart, dayEnd);
      addTotalValueData(byDate, tvData, dayKey);
    } catch (err) {
      console.warn(`[ig-backfill] daily ${dayKey} total_value failed: ${err.message}`);
    }
  }

  let count = 0;
  for (const row of byDate.values()) {
    await upsertAccountDaily(db, userId, igId, row);
    count++;
  }

  console.log(`[ig-backfill] account daily upserted: ${count} days (${since} → ${until})`);
  return count;
}

// ─── Media lifetime metrics ─────────────────────────────────────────────────

async function fetchMediaInsights(mediaId, igToken) {
  const insights = {};
  try {
    const ins = await metaFetch(`/${mediaId}/insights`, {
      metric: MEDIA_METRICS.join(','),
    }, igToken);
    for (const row of ins?.data || []) {
      insights[row.name] = Number(row.values?.[0]?.value || 0);
    }
    return insights;
  } catch (err) {
    console.warn(`[ig-backfill] bulk media insights failed for ${mediaId}: ${err.message}`);
    for (const metric of MEDIA_METRICS) {
      try {
        const ins = await metaFetch(`/${mediaId}/insights`, { metric }, igToken);
        insights[metric] = Number(ins?.data?.[0]?.values?.[0]?.value || 0);
      } catch (metricErr) {
        console.debug(`[ig-backfill] media ${mediaId} metric ${metric} unsupported: ${metricErr.message}`);
      }
    }
    return insights;
  }
}

async function upsertMediaPerformance(db, userId, igId, m, insights) {
  await db.query(
    `INSERT INTO public.meta_ig_media_performance
       (user_id, ig_id, media_id, media_type, media_product_type, caption,
        permalink, timestamp, reach, views, likes, comments, shares,
        saved, total_interactions, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
     ON CONFLICT (user_id, media_id) DO UPDATE SET
       media_type         = EXCLUDED.media_type,
       media_product_type = EXCLUDED.media_product_type,
       caption            = EXCLUDED.caption,
       permalink          = EXCLUDED.permalink,
       reach              = EXCLUDED.reach,
       views              = EXCLUDED.views,
       likes              = EXCLUDED.likes,
       comments           = EXCLUDED.comments,
       shares             = EXCLUDED.shares,
       saved              = EXCLUDED.saved,
       total_interactions = EXCLUDED.total_interactions,
       updated_at         = NOW()`,
    [
      userId, igId, m.id,
      m.media_type ?? null,
      m.media_product_type ?? null,
      m.caption ?? null,
      m.permalink ?? null,
      m.timestamp,
      Number(insights.reach || 0),
      Number(insights.views || 0),
      Number(insights.likes || 0),
      Number(insights.comments || 0),
      Number(insights.shares || 0),
      Number(insights.saved || 0),
      Number(insights.total_interactions || 0),
    ]
  );
}

async function backfillMedia(db, userId, igId, igToken) {
  const fields = 'id,caption,media_type,media_product_type,permalink,timestamp';
  let upserted = 0;
  let after = null;

  while (upserted < MEDIA_LIMIT) {
    const params = {
      fields,
      limit: String(Math.min(MEDIA_LIMIT, 50)),
    };
    if (after) params.after = after;
    const data = await metaFetch(`/${igId}/media`, params, igToken);
    const items = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) break;

    for (const m of items) {
      if (upserted >= MEDIA_LIMIT) break;

      const insights = await fetchMediaInsights(m.id, igToken);
      await upsertMediaPerformance(db, userId, igId, m, insights);
      upserted++;
    }

    after = data?.paging?.cursors?.after || null;
    if (!after) break;
  }
  console.log(`[ig-backfill] media upserted: ${upserted}`);
  return upserted;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date();
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const sinceDate = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate() - (BACKFILL_DAYS - 1)));
  const since = toYyyyMmDd(sinceDate);
  const until = toYyyyMmDd(yesterday);

  const db = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();

  try {
    const { igId, pageId } = await resolveIgAndPage(db);
    if (!pageId) throw new Error('IG access requires a linked Page (pageId not resolved).');

    const userId = await resolveReportUserId(db, igId);
    const pageToken = await getPageAccessToken(pageId);

    // Persist igBusinessAccountId in integrations.metadata for future use.
    await db.query(
      `UPDATE public.integrations
          SET metadata = jsonb_set(coalesce(metadata,'{}'::jsonb), '{igBusinessAccountId}', to_jsonb($1::text), true)
        WHERE service='meta' AND user_id=$2`,
      [igId, userId]
    );

    console.log(`[ig-backfill] window: ${since} → ${until} (${BACKFILL_DAYS}d) | ig=${igId} | page=${pageId} | user=${userId}`);

    await backfillAccountDaily(db, userId, igId, pageToken, since, until);
    await backfillMedia(db, userId, igId, pageToken);

    console.log('[ig-backfill] ✓ Done.');
  } catch (err) {
    console.error(`[ig-backfill] Fatal: ${err.message}`);
    await db.end();
    process.exit(1);
  }
  await db.end();
}

main();
