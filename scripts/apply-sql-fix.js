const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runSQL() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is missing in .env');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260512120000_fix_matching_and_revenue.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing SQL fix...');
    await client.query(sql);
    console.log('SQL fix applied successfully');

    console.log('Running matching function...');
    const res = await client.query('SELECT public.match_leads_to_doctoralia_by_phone() as count');
    console.log(`Matching completed. Leads updated: ${res.rows[0].count}`);

  } catch (err) {
    console.error('Error applying SQL fix:', err.message);
  } finally {
    await client.end();
  }
}

runSQL();
