// meta-data-audit.js
// Run: node scripts/meta-data-audit.js
// Reads Meta API (last 90 days) + DB tables and prints a human-readable report.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const https = require('https');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_KEY,
  META_ACCESS_TOKEN: META_TOKEN,
  META_AD_ACCOUNT_ID: META_ACCOUNT, // e.g. act_123456
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

function metaUrl(path, params) {
  const base = `https://graph.facebook.com/v21.0${path}`;
  const qs = new URLSearchParams({ access_token: META_TOKEN, ...params });
  return `${base}?${qs}`;
}

async function supabaseQuery(table, select, filtersArr = [], order = '', limit = '') {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  // filtersArr: [{col, op, val}] => col=op.val
  for (const { col, op, val } of filtersArr) {
    url += `&${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`;
  }
  if (order) url += `&order=${encodeURIComponent(order)}`;
  if (limit) url += `&limit=${limit}`;
  const res = await new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: r.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
  return res;
}

function fmt(n) {
  if (n == null) return '—';
  return typeof n === 'number' ? n.toLocaleString('es-MX') : n;
}
function cur(n) {
  if (n == null) return '—';
  return `€${Number(n).toFixed(2)}`;
}
function pct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(2)}%`;
}
function divSafe(a, b) {
  return b > 0 ? a / b : null;
}

// ── Dates ────────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const since90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const march2025From = '2025-03-01';
const march2025To   = '2025-03-31';

const hr = () => console.log('─'.repeat(70));
const h1 = (t) => { hr(); console.log(t); hr(); };
const h2 = (t) => console.log(`\n▶ ${t}`);

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  h1('META DATA AUDIT  —  ' + today);
  console.log(`Period: ${since90} → ${today}  (last 90 days)`);
  console.log(`Token configured: ${META_TOKEN ? 'YES (length=' + META_TOKEN.length + ')' : 'NO'}`);
  console.log(`Ad account configured: ${META_ACCOUNT ? 'YES' : 'NO'}`);

  // ══════════════════════════════════════════════════════════════════════════
  // 1. META API — INSIGHTS (last 90 days, daily breakdown)
  // ══════════════════════════════════════════════════════════════════════════
  h1('1. GET /meta/insights  (last 90 days, daily)');
  let insightsRows = [];
  let insightsError = null;

  if (!META_TOKEN || !META_ACCOUNT) {
    insightsError = 'META_ACCESS_TOKEN or META_AD_ACCOUNT_ID not set in .env';
    console.log('ERROR:', insightsError);
  } else {
    console.log('NOTE: META_APP_SECRET is stored only in Supabase Secrets (not in .env).');
    console.log('      Direct Meta API calls from this script require appsecret_proof.');
    console.log('      Skipping live Meta API call — will use DB fallback data only.');
    console.log('      To get live data, call the production Edge Function (GET /api/meta/insights).');
    insightsError = 'appsecret_proof required but META_APP_SECRET not available locally (see note above)';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. META API — CAMPAIGNS (last 90 days)
  // ══════════════════════════════════════════════════════════════════════════
  h1('2. GET /meta/campaigns  (last 90 days)');

  if (!META_TOKEN || !META_ACCOUNT) {
    console.log('ERROR: credentials not configured — skipping.');
  } else {
    console.log('NOTE: Same appsecret_proof constraint applies. Skipping live Meta campaign call.');
    console.log('      Use the production Edge Function (GET /api/meta/campaigns) to get live data.');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. DB — meta_daily_insights (March 2025 + last 90 days)
  // ══════════════════════════════════════════════════════════════════════════
  h1('3. DB  —  meta_daily_insights');

  h2(`3a. Rows for March 2025 (${march2025From} → ${march2025To})`);
  try {
    const res = await supabaseQuery(
      'meta_daily_insights',
      'date,ad_account_id,impressions,clicks,spend,conversions,ctr,cpc,cpm',
      [
        { col: 'date', op: 'gte', val: march2025From },
        { col: 'date', op: 'lte', val: march2025To },
      ],
      'date.asc',
      '200'
    );
    if (res.status !== 200) {
      console.log(`  DB error (HTTP ${res.status}):`, JSON.stringify(res.body).slice(0, 300));
    } else if (!Array.isArray(res.body) || res.body.length === 0) {
      console.log('  No rows found for March 2025.  Possible reasons:');
      console.log('  - No Meta campaigns ran in March 2025, OR');
      console.log('  - POST /meta/backfill was not run to ingest historical data.');
    } else {
      console.log(`  Found ${res.body.length} rows for March 2025.`);
      const sumN = (k) => res.body.reduce((s, d) => s + Number(d[k] || 0), 0);
      console.log(`  Spend       : ${cur(Number(sumN('spend').toFixed(2)))}`);
      console.log(`  Impressions : ${fmt(Math.round(sumN('impressions')))}`);
      console.log(`  Clicks      : ${fmt(Math.round(sumN('clicks')))}`);
      console.log(`  Conversions : ${fmt(Math.round(sumN('conversions')))}`);
      console.log('  Daily breakdown:');
      for (const d of res.body) {
        const sp = Number(d.spend || 0);
        if (sp > 0) {
          console.log(`    ${d.date}  spend=${cur(sp)}  clicks=${d.clicks}  impr=${d.impressions}  conv=${d.conversions}`);
        }
      }
      const zeroDays = res.body.filter(d => Number(d.spend || 0) === 0);
      if (zeroDays.length > 0) {
        console.log(`  Days with spend=0: ${zeroDays.length}  (${zeroDays.map(d => d.date).join(', ')})`);
      }
    }
  } catch (e) {
    console.log('  DB query error:', e.message);
  }

  h2(`3b. Rows for last 90 days (${since90} → ${today})`);
  try {
    const res = await supabaseQuery(
      'meta_daily_insights',
      'date,ad_account_id,impressions,clicks,spend,conversions',
      [
        { col: 'date', op: 'gte', val: since90 },
        { col: 'date', op: 'lte', val: today },
      ],
      'date.desc',
      '500'
    );
    if (res.status !== 200) {
      console.log(`  DB error (HTTP ${res.status}):`, JSON.stringify(res.body).slice(0, 300));
    } else if (!Array.isArray(res.body) || res.body.length === 0) {
      console.log('  No rows found in meta_daily_insights for the last 90 days.');
      console.log('  → Run POST /meta/backfill?days=90 to populate this table.');
    } else {
      const sumN = (k) => res.body.reduce((s, d) => s + Number(d[k] || 0), 0);
      console.log(`  Found ${res.body.length} rows for last 90 days.`);
      console.log(`  Spend       : ${cur(Number(sumN('spend').toFixed(2)))}`);
      console.log(`  Impressions : ${fmt(Math.round(sumN('impressions')))}`);
      console.log(`  Clicks      : ${fmt(Math.round(sumN('clicks')))}`);
      console.log(`  Conversions : ${fmt(Math.round(sumN('conversions')))}`);
    }
  } catch (e) {
    console.log('  DB query error:', e.message);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DB — meta_cache
  // ══════════════════════════════════════════════════════════════════════════
  h1('4. DB  —  meta_cache');
  try {
    const res = await supabaseQuery(
      'meta_cache',
      'id,updated_at',
      [],
      'updated_at.desc',
      '20'
    );
    if (res.status !== 200) {
      console.log(`  DB error (HTTP ${res.status}):`, JSON.stringify(res.body).slice(0, 300));
    } else if (!Array.isArray(res.body) || res.body.length === 0) {
      console.log('  meta_cache is empty — no cached API responses stored.');
    } else {
      console.log(`  ${res.body.length} cache entries found (id = cache key):`);
      for (const row of res.body) {
        console.log(`  [${row.updated_at?.slice(0, 19)}]  ${row.id}`);
      }
    }
  } catch (e) {
    console.log('  DB query error:', e.message);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. DB — meta_cache data (read cached API responses)
  // ══════════════════════════════════════════════════════════════════════════
  h1('5. Cached Meta API responses (from meta_cache)');
  try {
    const res = await supabaseQuery(
      'meta_cache',
      'id,data,updated_at',
      [],
      'updated_at.desc',
      '20'
    );
    if (res.status !== 200 || !Array.isArray(res.body) || res.body.length === 0) {
      console.log('  No cache entries to read.');
    } else {
      for (const row of res.body) {
        const d = row.data;
        if (!d) continue;
        h2(`Cache entry: ${row.id}  (last updated ${row.updated_at?.slice(0, 19)})`);
        console.log(`  Source: ${d.source || '—'}  Cached: ${d.cached}  Degraded: ${d.degraded || false}`);
        if (d.period) {
          console.log(`  Period: ${d.period.since} → ${d.period.until}  (${d.period.days} days)`);
        }
        if (d.accountId) console.log(`  Account: ${d.accountId}`);
        if (d.currency) console.log(`  Currency: ${d.currency}`);

        // ── insights summary ──────────────────────────────────────────────
        const s = d.summary;
        if (s) {
          console.log(`  ── Summary ──`);
          if (s.impressions != null) console.log(`    Impressions : ${fmt(s.impressions)}`);
          if (s.clicks      != null) console.log(`    Clicks      : ${fmt(s.clicks)}`);
          if (s.spend       != null) console.log(`    Spend       : ${cur(s.spend)}`);
          if (s.conversions != null) console.log(`    Conversions : ${fmt(s.conversions)}`);
          if (s.ctr         != null) console.log(`    CTR         : ${pct(s.ctr)}`);
          if (s.cpc         != null) console.log(`    CPC         : ${cur(s.cpc)}`);
          if (s.cpm         != null) console.log(`    CPM         : ${cur(s.cpm)}`);
          if (s.messagingConversationStarted != null) console.log(`    Messaging convs: ${fmt(s.messagingConversationStarted)}`);
          // dashboard meta-trends has thisWeek nested
          if (s.thisWeek) {
            const tw = s.thisWeek;
            console.log(`    (thisWeek) Impressions: ${fmt(tw.impressions)}  Clicks: ${fmt(tw.clicks)}  Spend: ${cur(tw.spend)}  Conv: ${fmt(tw.conversions)}`);
          }
        }

        // ── campaign list ──────────────────────────────────────────────────
        if (Array.isArray(d.campaigns)) {
          const withIns = d.campaigns.filter(c => c.insights?.spend > 0);
          const noIns   = d.campaigns.filter(c => !c.insights || c.insights.spend == 0);
          console.log(`  ── Campaigns: ${d.campaigns.length} total  (${withIns.length} with spend > 0) ──`);
          for (const c of d.campaigns) {
            const ins = c.insights;
            const sp = ins?.spend ?? 0;
            const cl = ins?.clicks ?? 0;
            const im = ins?.impressions ?? 0;
            const cv = ins?.conversions ?? 0;
            const ctr2 = im > 0 ? (cl / im * 100).toFixed(2) : '—';
            const cpc2 = cl > 0 ? (sp / cl).toFixed(2) : '—';
            const cpm2 = im > 0 ? (sp / im * 1000).toFixed(2) : '—';
            if (sp > 0) {
              console.log(`\n    Campaign  : ${c.name}`);
              console.log(`    ID        : ${c.id}`);
              console.log(`    Status    : ${c.status}`);
              console.log(`    Objective : ${c.objective || '—'}`);
              console.log(`    Spend     : ${cur(sp)}`);
              console.log(`    Impress.  : ${fmt(Math.round(im))}`);
              console.log(`    Clicks    : ${fmt(Math.round(cl))}`);
              console.log(`    Conv.     : ${fmt(Math.round(cv))}`);
              console.log(`    CTR       : ${ctr2}%`);
              console.log(`    CPC       : ${cur(Number(cpc2) || null)}`);
              console.log(`    CPM       : ${cur(Number(cpm2) || null)}`);
            }
          }
          if (noIns.length > 0) {
            console.log(`\n    Campaigns with zero spend (${noIns.length}):`);
            for (const c of noIns) {
              console.log(`    - ${c.name}  [${c.status}]  spend=${cur(c.insights?.spend ?? 0)}`);
            }
          }
        }

        // ── daily breakdown (max 15 rows with spend > 0) ───────────────────
        if (Array.isArray(d.daily) && d.daily.length > 0) {
          const activeDays = d.daily.filter(dd => Number(dd.spend || 0) > 0);
          const zeroDays   = d.daily.filter(dd => Number(dd.spend || 0) === 0);
          const missing    = (d.period?.days || 0) - d.daily.length;
          console.log(`  ── Daily breakdown: ${d.daily.length} rows  (${activeDays.length} with spend > 0, ${zeroDays.length} zero-spend)`);
          if (missing > 0) {
            console.log(`     ${missing} days missing from API response — Meta omits days with no ad activity.`);
          }
          if (activeDays.length > 0) {
            console.log('     Date        Impr      Clicks  Spend       Conv   CTR      CPC      CPM');
            for (const dd of activeDays.slice(-15)) {
              const sp = Number(dd.spend || 0);
              const cl = Number(dd.clicks || 0);
              const im = Number(dd.impressions || 0);
              const cv = Number(dd.conversions || 0);
              const ctr2 = im > 0 ? (cl / im * 100).toFixed(2) : '—';
              const cpc2 = cl > 0 ? (sp / cl).toFixed(2) : '—';
              const cpm2 = im > 0 ? (sp / im * 1000).toFixed(2) : '—';
              console.log(`     ${dd.date}  ${String(Math.round(im)).padStart(8)}  ${String(Math.round(cl)).padStart(6)}  ${cur(sp).padStart(9)}  ${String(Math.round(cv)).padStart(4)}   ${ctr2}%   €${cpc2}   €${cpm2}`);
            }
          }
        }
      }
    }
  } catch (e) {
    console.log('  DB query error:', e.message);
  }

  h1('AUDIT COMPLETE');
})();
