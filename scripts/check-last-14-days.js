
require('dotenv').config();
const https = require('https');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

function supabaseQuery(table, select, filtersArr = [], order = '', limit = '') {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  for (const { col, op, val } of filtersArr) {
    url += `&${encodeURIComponent(col)}=${op}.${encodeURIComponent(val)}`;
  }
  if (order) url += `&order=${encodeURIComponent(order)}`;
  if (limit) url += `&limit=${limit}`;
  
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
}

(async () => {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  console.log(`Checking data since: ${fourteenDaysAgo}`);
  
  try {
    const res = await supabaseQuery(
      'meta_daily_insights',
      '*',
      [{ col: 'date', op: 'gte', val: fourteenDaysAgo }],
      'date.desc'
    );
    
    if (res.status === 200) {
      console.log(`Found ${res.body.length} rows.`);
      if (res.body.length > 0) {
        console.table(res.body.map(r => ({ date: r.date, spend: r.spend, clicks: r.clicks, impressions: r.impressions })));
      } else {
        console.log('No data found for the last 14 days.');
      }
    } else {
      console.error(`Error ${res.status}:`, res.body);
    }
  } catch (error) {
    console.error('Request failed:', error.message);
  }
})();
