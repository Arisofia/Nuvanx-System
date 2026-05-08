/**
 * Nuvanx System Health Check Script (Deno)
 * 
 * Verifies that critical Edge Functions and API endpoints are responsive.
 * Usage: deno run --allow-net --allow-env scripts/health-check-nuvanx.ts
 */

const SUPABASE_URL = Deno.env.get('VITE_SUPABASE_URL') || 'https://ssvvuuysgxyqvmovrlvk.supabase.co';
const MCP_API_KEY = Deno.env.get('MCP_API_KEY');

const endpoints = [
  { 
    name: 'MCP Health', 
    url: `${SUPABASE_URL}/functions/v1/mcp/health` 
  },
  { 
    name: 'KPIs (Demo Clinic)', 
    url: `${SUPABASE_URL}/functions/v1/api/kpis?clinic_id=demo` 
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

let failed = 0;

for (const ep of endpoints) {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
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
    console.error(`❌ ${ep.name.padEnd(20)}: ERROR - ${e.message}`);
  }
}

console.log(`\n--- Health Check Finished: ${endpoints.length - failed} PASSED, ${failed} FAILED ---`);

if (failed > 0) {
  Deno.exit(1);
}
