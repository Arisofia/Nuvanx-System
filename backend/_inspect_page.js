/* eslint-disable */
require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: '../.env.local', override: false });
const { Client } = require('pg');

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query("SELECT user_id, metadata FROM integrations WHERE service='meta'");
  for (const row of r.rows) {
    const md = row.metadata || {};
    console.log('user:', row.user_id);
    console.log('  pageId:', md.pageId || md.page_id || '(none)');
    console.log('  pageAccessToken:', md.pageAccessToken ? '(present)' : '(absent)');
    console.log('  hasUserToken:', md.token ? '(present)' : '(absent)');
  }
  await c.end();
})().catch(e => { console.error(e.message); process.exit(2); });
