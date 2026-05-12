/**
 * Nuvanx System Health Check Script (Deno)
 * 
 * Verifies that critical Edge Functions and API endpoints are responsive.
 * Usage: deno run --allow-net --allow-env scripts/health-check-nuvanx.ts
 */

async function loadDotenv() {
  const dotenvFiles = ['.env.local', '.env'];
  for (const path of dotenvFiles) {
    try {
      const stat = await Deno.stat(path);
      if (!stat.isFile) continue;
    } catch {
      continue;
    }

    const content = await Deno.readTextFile(path);
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const normalizedLine = line.startsWith('export ') ? line.slice(7) : line;
      const [key, ...valueParts] = normalizedLine.split('=');
      if (!key || valueParts.length === 0) continue;
      let value = valueParts.join('=').trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!Deno.env.get(key)) {
        Deno.env.set(key, value);
      }
    }
  }
}

await loadDotenv();

const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') || 'https://ssvvuuysgxyqvmovrlvk.supabase.co';
const MCP_API_KEY = Deno.env.get('MCP_API_KEY');
const SERVICE_ROLE_KEY = Deno.env.get('NUVANX_SUPABASE_SERVICE_ROLE_KEY');
const REPORT_USER_ID = Deno.env.get('REPORT_USER_ID');

const endpoints = [
  { 
    name: 'MCP Health', 
    url: `${SUPABASE_URL}/functions/v1/mcp/health` 
  },
  { 
    name: 'KPIs', 
    url: `${SUPABASE_URL}/functions/v1/api/kpis` 
  },
  { 
    name: 'Dashboard Metrics', 
    url: `${SUPABASE_URL}/functions/v1/api/dashboard/metrics` 
  },
  { 
    name: 'Daily Aggregates', 
    url: `${SUPABASE_URL}/functions/v1/daily-aggregates` 
  }
];

console.log(`--- Starting Nuvanx Health Check [${new Date().toISOString()}] ---`);
console.log(`Target: ${SUPABASE_URL}\n`);

if (!SERVICE_ROLE_KEY) {
  console.warn('Warning: NUVANX_SUPABASE_SERVICE_ROLE_KEY is missing. Protected /api routes will fail without this secret.');
}
if (SERVICE_ROLE_KEY && !REPORT_USER_ID) {
  console.warn('Warning: NUVANX_SUPABASE_SERVICE_ROLE_KEY is present but REPORT_USER_ID is missing. x-user-id header will not be sent.');
}

let failed = 0;

for (const ep of endpoints) {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    if (SERVICE_ROLE_KEY && ep.url.includes('/functions/v1/api/')) {
      headers['Authorization'] = `Bearer ${SERVICE_ROLE_KEY}`;
      if (REPORT_USER_ID) {
        headers['x-user-id'] = REPORT_USER_ID;
      }
    }

    if (MCP_API_KEY) {
      headers['x-api-key'] = MCP_API_KEY;
    }

    const start = performance.now();
    const res = await fetch(ep.url, { headers });
    const duration = Math.round(performance.now() - start);

    if (res.ok) {
      console.log(`✅ ${ep.name.padEnd(20)}: OK (${res.status}) [${duration}ms]`);
    } else {
      failed++;
      const text = await res.text();
      console.error(`❌ ${ep.name.padEnd(20)}: FAILED (${res.status}) [${duration}ms]`);
      console.error(`   Reason: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`);
    }
  } catch (e) {
    failed++;
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`❌ ${ep.name.padEnd(20)}: ERROR - ${errorMessage}`);
  }
}

console.log(`\n--- Health Check Finished: ${endpoints.length - failed} PASSED, ${failed} FAILED ---`);

if (failed > 0) {
  Deno.exit(1);
}
