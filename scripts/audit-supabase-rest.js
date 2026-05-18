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

async function auditViaRest() {
  const env = readEnv(path.join(__dirname, '.env.tokens.local'));
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || key.includes('REPLACE')) {
    console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  const tables = [
    'leads',
    'financial_settlements',
    'meta_daily_insights',
    'produccion_intermediarios'
  ];

  console.log('--- AUDITING SUPABASE TABLES (REST API) ---');
  for (const table of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=count`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Range-Unit': 'items',
          'Prefer': 'count=exact'
        }
      });
      
      const countHeader = res.headers.get('content-range');
      if (res.ok && countHeader) {
        const total = countHeader.split('/')[1];
        console.log(`✅ ${table.padEnd(35)}: OK (${total} rows)`);
      } else {
        const text = await res.text();
        console.log(`❌ ${table.padEnd(35)}: ERROR (${res.status}) - ${text.substring(0, 100)}`);
      }
    } catch (err) {
      console.log(`❌ ${table.padEnd(35)}: FATAL - ${err.message}`);
    }
  }
}

auditViaRest().catch(console.error);
