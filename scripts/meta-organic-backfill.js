#!/usr/bin/env node
/**
 * meta-organic-backfill.js
 *
 * Back-fills meta_organic_daily (page-level totals) and meta_post_performance
 * (post-level lifetime metrics) from the Meta Page Insights API.
 *
 * Required env vars:
 *   META_ACCESS_TOKEN  — Meta System User access token
 *   META_PAGE_ID       — e.g. "685010274687129" (or set via integrations metadata)
 *   DATABASE_URL       — Postgres connection string
 *
 * Optional:
 *   META_APP_SECRET   — adds appsecret_proof (recommended)
 *   META_PAGE_IDS     — comma/semicolon-separated multi-page list (overrides META_PAGE_ID)
 *   REPORT_USER_ID    — UUID; if omitted, auto-discovered from integrations
 *   BACKFILL_DAYS     — page-level lookback (default 90, max 365)
 *   POSTS_LIMIT       — max posts to backfill (default 200)
 */

'use strict';

const { Client } = require('pg');
const crypto     = require('node:crypto');

const META_GRAPH = 'https://graph.facebook.com/v22.0';

const {
  META_ACCESS_TOKEN: token,
  META_PAGE_ID:      rawPageId,
  META_PAGE_IDS:     rawPageIds,
  META_APP_SECRET:   appSecret,
  DATABASE_URL:      databaseUrl,
  REPORT_USER_ID:    reportUserIdEnv,
} = process.env;

const BACKFILL_DAYS = Math.min(
  Math.max(Number.parseInt(process.env.BACKFILL_DAYS || '90', 10) || 90, 1),
  365
);
const POSTS_LIMIT = Math.min(
  Math.max(Number.parseInt(process.env.POSTS_LIMIT || '200', 10) || 200, 1),
  1000
);

const PAGE_METRICS = [
  'page_impressions_unique',          // reach (mixed organic+paid)
  'page_post_engagements',            // total post engagements
  'page_views_total',                 // page profile views
  'page_video_views',                 // video views (page-level)
  'page_actions_post_reactions_total' // reactions
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizePageIds(raw) {
  if (Array.isArray(raw)) return raw.flatMap((x) => normalizePageIds(x));
  if (raw === undefined || raw === null) return [];
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter((s) => /^\d{6,20}$/.test(s));
}

const pageIds = (() => {
  const fromMulti = normalizePageIds(rawPageIds);
  if (fromMulti.length > 0) return fromMulti;
  return normalizePageIds(rawPageId);
})();

if (!token || !databaseUrl) {
  console.error('[organic-backfill] Missing META_ACCESS_TOKEN or DATABASE_URL.');
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
      throw new Error(`[Meta Error] code=${code} msg=${msg}`);
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

async function getPageAccessToken(pageId) {
  const data = await metaFetch('/me/accounts', { fields: 'id,access_token,tasks', limit: '100' }, token);
  const list = Array.isArray(data?.data) ? data.data : [];
  const match = list.find((p) => String(p.id) === String(pageId));
  if (!match) {
    throw new Error(`Page ${pageId} not in /me/accounts (System User has no access). Available: ${list.map((p) => p.id).join(', ')}`);
  }
  if (!match.access_token) {
    throw new Error(`Page ${pageId} returned by /me/accounts but without access_token (insufficient task permissions).`);
  }
  return match.access_token;
}

function toYyyyMmDd(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

async function resolveReportUserId(db, pageId) {
  if (reportUserIdEnv) return reportUserIdEnv;
  const { rows } = await db.query(
    `SELECT user_id FROM public.integrations
     WHERE service = 'meta'
       AND (metadata->>'pageId' = $1 OR metadata->>'page_id' = $1)
     LIMIT 1`,
    [pageId]
  );
  if (rows[0]?.user_id) {
    console.log('[organic-backfill] Resolved REPORT_USER_ID from integrations.pageId.');
    return rows[0].user_id;
  }
  const fb = await db.query(`SELECT user_id FROM public.integrations WHERE service='meta' LIMIT 1`);
  if (fb.rows[0]?.user_id) {
    console.log('[organic-backfill] Fallback REPORT_USER_ID = first meta integration.');
    return fb.rows[0].user_id;
  }
  throw new Error('Cannot resolve REPORT_USER_ID: no Meta integration in DB.');
}

// ─── Page-level daily insights ──────────────────────────────────────────────

async function backfillPageDaily(db, userId, pageId, pageToken, since, until) {
  const data = await metaFetch(`/${pageId}/insights`, {
    metric: PAGE_METRICS.join(','),
    period: 'day',
    since,
    until,
  }, pageToken);

  const series = Array.isArray(data?.data) ? data.data : [];
  // Build date → metric → value map.
  const byDate = new Map();
  for (const m of series) {
    const name = m.name;
    for (const v of m.values || []) {
      const day = (v.end_time || '').slice(0, 10);
      if (!day) continue;
      const row = byDate.get(day) || { day };
      row[name] = Number(v.value || 0);
      byDate.set(day, row);
    }
  }

  let count = 0;
  for (const r of byDate.values()) {
    await db.query(
      `INSERT INTO public.meta_organic_daily
         (user_id, page_id, date, impressions, reach, engagements, video_views, page_views, reactions, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())
       ON CONFLICT (user_id, page_id, date) DO UPDATE SET
         impressions = EXCLUDED.impressions,
         reach       = EXCLUDED.reach,
         engagements = EXCLUDED.engagements,
         video_views = EXCLUDED.video_views,
         page_views  = EXCLUDED.page_views,
         reactions   = EXCLUDED.reactions,
         updated_at  = NOW()`,
      [
        userId, pageId, r.day,
        Number(r.page_impressions_unique || 0),         // impressions (= reach unique on Meta semantics)
        Number(r.page_impressions_unique || 0),         // reach (Meta v22 only exposes unique at page level)
        Number(r.page_post_engagements || 0),
        Number(r.page_video_views || 0),
        Number(r.page_views_total || 0),
        Number(r.page_actions_post_reactions_total || 0),
      ]
    );
    count++;
  }
  console.log(`[organic-backfill] page=${pageId} daily rows upserted: ${count}`);
  return count;
}

// ─── Post-level lifetime metrics ────────────────────────────────────────────

async function backfillPosts(db, userId, pageId, pageToken) {
  // /posts returns timeline (organic) posts. Use lifetime insights metric.
  const fields = [
    'id',
    'created_time',
    'message',
    'status_type',
    'permalink_url',
    'attachments{media_type}',
    `insights.metric(post_impressions_unique,post_reactions_by_type_total,post_video_views,post_clicks,post_activity_by_action_type)`,
  ].join(',');

  let upserted = 0;
  let nextUrl = null;
  let firstParams = { fields, limit: String(Math.min(POSTS_LIMIT, 100)) };

  while (upserted < POSTS_LIMIT) {
    let data;
    if (nextUrl) {
      // Paginate using full URL from Meta (already includes access token + cursors).
      const res = await fetch(nextUrl, { signal: AbortSignal.timeout(30000) });
      data = await res.json();
      if (!res.ok) throw new Error(`[Meta paging] ${data?.error?.message || res.status}`);
    } else {
      data = await metaFetch(`/${pageId}/posts`, firstParams, pageToken);
    }
    const posts = Array.isArray(data?.data) ? data.data : [];
    if (posts.length === 0) break;

    for (const p of posts) {
      if (upserted >= POSTS_LIMIT) break;

      const insightsByName = new Map();
      for (const ins of p.insights?.data || []) {
        insightsByName.set(ins.name, ins.values?.[0]?.value);
      }
      const reactionsObj = insightsByName.get('post_reactions_by_type_total') || {};
      const reactionsTotal = Object.values(reactionsObj).reduce((a, b) => a + Number(b || 0), 0);

      // post_activity_by_action_type returns a map like { share: N, comment: N, like: N }
      const activityObj = insightsByName.get('post_activity_by_action_type') || {};
      const comments = Number(activityObj.comment || 0);
      const shares   = Number(activityObj.share || 0);
      const engagedUsers = reactionsTotal + comments + shares;

      const attachments = p.attachments?.data || [];
      const mediaType = attachments[0]?.media_type || '';
      const isVideo = /video|reel/i.test(mediaType) || p.status_type === 'added_video';

      await db.query(
        `INSERT INTO public.meta_post_performance
           (user_id, page_id, post_id, created_time, message, status_type, permalink_url,
            impressions, reach, engaged_users, reactions, comments, shares,
            video_views, is_video, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
         ON CONFLICT (user_id, post_id) DO UPDATE SET
           message       = EXCLUDED.message,
           status_type   = EXCLUDED.status_type,
           permalink_url = EXCLUDED.permalink_url,
           impressions   = EXCLUDED.impressions,
           reach         = EXCLUDED.reach,
           engaged_users = EXCLUDED.engaged_users,
           reactions     = EXCLUDED.reactions,
           comments      = EXCLUDED.comments,
           shares        = EXCLUDED.shares,
           video_views   = EXCLUDED.video_views,
           is_video      = EXCLUDED.is_video,
           updated_at    = NOW()`,
        [
          userId,
          pageId,
          p.id,
          p.created_time,
          p.message ?? null,
          p.status_type ?? null,
          p.permalink_url ?? null,
          Number(insightsByName.get('post_impressions_unique') || 0), // impressions (Meta v22: unique-only at post level w/o ads)
          Number(insightsByName.get('post_impressions_unique') || 0),
          engagedUsers,
          reactionsTotal,
          comments,
          shares,
          Number(insightsByName.get('post_video_views') || 0),
          Boolean(isVideo),
        ]
      );
      upserted++;
    }

    nextUrl = data?.paging?.next || null;
    if (!nextUrl) break;
    firstParams = null;
  }

  console.log(`[organic-backfill] page=${pageId} posts upserted: ${upserted}`);
  return upserted;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date();
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const sinceDate = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate() - (BACKFILL_DAYS - 1)));
  const since = toYyyyMmDd(sinceDate);
  const until = toYyyyMmDd(yesterday);

  let pages = pageIds.slice();
  const db = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // If no page IDs provided, auto-discover from integrations.
  if (pages.length === 0) {
    const { rows } = await db.query(
      `SELECT DISTINCT metadata->>'pageId' AS pid
         FROM public.integrations
        WHERE service='meta' AND coalesce(metadata->>'pageId', metadata->>'page_id') <> ''`
    );
    pages = rows.map((r) => r.pid).filter(Boolean);
    if (pages.length === 0) {
      // Fallback: discover from /me/accounts using the system token.
      const acc = await metaFetch('/me/accounts', { fields: 'id,name', limit: '100' }, token);
      pages = (acc?.data || []).map((p) => String(p.id));
      console.log(`[organic-backfill] Auto-discovered pages from /me/accounts: ${pages.join(', ') || '(none)'}`);
    }
    if (pages.length === 0) {
      throw new Error('No page IDs to backfill. Set META_PAGE_ID(S) or store pageId in integrations.metadata.');
    }
  }

  console.log(`[organic-backfill] window: ${since} → ${until} (${BACKFILL_DAYS}d) | pages: ${pages.join(', ')}`);

  let firstError = null;
  for (const pageId of pages) {
    try {
      const userId = await resolveReportUserId(db, pageId);
      const pageToken = await getPageAccessToken(pageId);
      await backfillPageDaily(db, userId, pageId, pageToken, since, until);
      await backfillPosts(db, userId, pageId, pageToken);
    } catch (err) {
      console.error(`[organic-backfill] Failed page ${pageId}: ${err.message}`);
      if (!firstError) firstError = err;
    }
  }

  await db.end();
  if (firstError) {
    console.error(`[organic-backfill] Completed with errors. First: ${firstError.message}`);
    process.exit(2);
  }
  console.log('[organic-backfill] ✓ Done.');
}

main().catch((err) => {
  console.error(`[organic-backfill] Fatal: ${err.message}`);
  process.exit(1);
});
