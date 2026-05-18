const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      env[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
  });
  return env;
}

async function checkTables() {
  const env = readEnv(path.join(__dirname, '.env.tokens.local'));
  const password = env.SUPABASE_DB_PASSWORD;
  const projectRef = env.SUPABASE_PROJECT_REF;
  
  // Use direct connection to avoid pooler issues during audit
  const connectionString = `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`;

  console.log('--- AUDITING SUPABASE TABLES ---');
  console.log(`Connecting to: db.${projectRef}.supabase.co`);

  const db = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await db.connect();
    const tables = [
      'public.leads',
      'public.financial_settlements',
      'public.meta_daily_insights',
      'public.produccion_intermediarios'
    ];

    for (const table of tables) {
      try {
        const { rows } = await db.query(`SELECT count(*) as total FROM ${table}`);
        console.log(`✅ ${table.padEnd(35)}: OK (${rows[0].total} rows)`);
      } catch (err) {
        console.log(`❌ ${table.padEnd(35)}: ERROR - ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`❌ Connection failed: ${err.message}`);
  } finally {
    await db.end();
  }
}

checkTables().catch(console.error);
