/* eslint-disable no-console */
require('dotenv').config({ path: '../.env' });
require('dotenv').config({ path: '../.env.local', override: false });
const { Client } = require('pg');

const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query("SELECT user_id, service FROM credentials WHERE service='meta'");
  console.log('Credentials count:', r.rows.length);
  for (const row of r.rows) {
    console.log('user:', row.user_id, 'service:', row.service);
  }

  const leads = await c.query("SELECT id, external_id, source FROM leads");
  console.log('Total leads count:', leads.rows.length);
  for (const lead of leads.rows) {
    console.log('lead:', lead.id, 'ext:', lead.external_id, 'src:', lead.source);
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(2); });
