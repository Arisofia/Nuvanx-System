/**
 * Nuvanx System Health Check Script (Deno)
 *
 * Verifies that critical production Edge Functions are reachable and that
 * protected API routes keep enforcing authentication when no health-check user
 * token is configured.
 *
 * Usage: deno run --allow-net --allow-env scripts/health-check-nuvanx.ts
 */

const DEFAULT_SUPABASE_URL = 'https://ssvvuuysgxyqvmovrlvk.supabase.co';
const SUPABASE_URL = (
  Deno.env.get('VITE_SUPABASE_URL') || Deno.env.get('SUPABASE_URL') || DEFAULT_SUPABASE_URL
).replace(/\/$/, '');
const MCP_API_KEY = Deno.env.get('MCP_API_KEY')?.trim();
const API_AUTH_TOKEN = Deno.env.get('HEALTH_CHECK_API_AUTH_TOKEN')?.trim();
<<<<<<< resolve-conflicts-62

const DEFAULT_TIMEOUT_MS = 10_000;
const TIMEOUT_MS = (() => {
  const raw = Deno.env.get('HEALTH_CHECK_TIMEOUT_MS');
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid HEALTH_CHECK_TIMEOUT_MS value "${raw}", using default ${DEFAULT_TIMEOUT_MS}ms instead.`,
    );
    return DEFAULT_TIMEOUT_MS;
  }

  return parsed;
})();

=======
const TIMEOUT_MS = Number(Deno.env.get('HEALTH_CHECK_TIMEOUT_MS') || 10_000);

>>>>>>> main
type Endpoint = {
  name: string;
  url: string;
  headers?: Record<string, string>;
  expectedStatuses: number[];
  healthyStatusLabel: string;
};

const authGuardExpectedStatuses = API_AUTH_TOKEN ? [200] : [401];
const authGuardLabel = API_AUTH_TOKEN ? 'authenticated response' : 'auth guard enforced';

const endpoints: Endpoint[] = [
  {
    name: 'API Health',
    url: `${SUPABASE_URL}/functions/v1/api/health`,
    expectedStatuses: [200],
    healthyStatusLabel: 'public health ok',
  },
  {
    name: 'MCP Health',
    url: `${SUPABASE_URL}/functions/v1/mcp/health`,
    headers: MCP_API_KEY ? { Authorization: `Bearer ${MCP_API_KEY}` } : undefined,
    expectedStatuses: [200],
    healthyStatusLabel: 'public health ok',
  },
  {
    name: 'Dashboard Metrics',
    url: `${SUPABASE_URL}/functions/v1/api/dashboard/metrics`,
    headers: API_AUTH_TOKEN ? { Authorization: `Bearer ${API_AUTH_TOKEN}` } : undefined,
    expectedStatuses: authGuardExpectedStatuses,
    healthyStatusLabel: authGuardLabel,
  },
  {
    name: 'KPIs',
    url: `${SUPABASE_URL}/functions/v1/api/kpis?clinic_id=demo`,
    headers: API_AUTH_TOKEN ? { Authorization: `Bearer ${API_AUTH_TOKEN}` } : undefined,
    expectedStatuses: authGuardExpectedStatuses,
    healthyStatusLabel: authGuardLabel,
  },
  {
    name: 'Daily Aggregates',
    url: `${SUPABASE_URL}/functions/v1/daily-aggregates`,
    expectedStatuses: [200],
    healthyStatusLabel: 'job endpoint ok',
  },
];

console.log(`--- Starting Nuvanx Health Check [${new Date().toISOString()}] ---`);
console.log(`Target: ${SUPABASE_URL}`);
console.log(`Timeout: ${TIMEOUT_MS}ms`);

if (!MCP_API_KEY) {
  console.log('ℹ️ MCP_API_KEY is not configured; checking the public MCP health endpoint only.');
}

if (!API_AUTH_TOKEN) {
  console.log(
    'ℹ️ HEALTH_CHECK_API_AUTH_TOKEN is not configured; protected API endpoints are expected to return 401.',
  );
}

console.log('');

let failed = 0;

for (const ep of endpoints) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(ep.headers || {}),
    };

    const start = performance.now();
    const res = await fetch(ep.url, { headers, signal: controller.signal });
    const duration = Math.round(performance.now() - start);

    if (ep.expectedStatuses.includes(res.status)) {
      console.log(
        `✅ ${ep.name.padEnd(20)}: OK (${res.status}, ${ep.healthyStatusLabel}) [${duration}ms]`,
      );
    } else {
      // If MCP_API_KEY is missing and we get a 401, it's expected but we'll mark as warning
      if (res.status === 401 && !MCP_API_KEY) {
        console.warn(`⚠️ ${ep.name.padEnd(20)}: SKIPPED (401 - Missing MCP_API_KEY) [${duration}ms]`);
        continue;
      }
      failed++;
      const text = await res.text();
      console.error(`❌ ${ep.name.padEnd(20)}: FAILED (${res.status}) [${duration}ms]`);
      console.error(`   Expected: ${ep.expectedStatuses.join(' or ')}`);
      console.error(`   Reason: ${text.slice(0, 160)}${text.length > 160 ? '...' : ''}`);
    }
  } catch (e) {
    failed++;
    const message = e instanceof Error ? e.message : String(e);
    console.error(`❌ ${ep.name.padEnd(20)}: ERROR - ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

console.log(
  `\n--- Health Check Finished: ${endpoints.length - failed} PASSED, ${failed} FAILED ---`,
);

if (failed > 0) {
  Deno.exit(1);
}
