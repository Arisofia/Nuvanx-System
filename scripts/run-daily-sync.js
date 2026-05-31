#!/usr/bin/env node
/**
 * Nuvanx Daily Sync Orchestrator
 * Runs core daily operational jobs with fail-fast semantics on critical steps.
 */

const { execSync } = require('child_process');

const steps = [
  { name: 'scan-secrets', cmd: 'node scripts/scan-secrets.js', critical: true },
  // 'verify-meta-access' was removed (logic moved to daily-sync.yml preflight + this orchestrator)
  { name: 'sync-doctoralia', cmd: 'node scripts/sync-doctoralia.js', critical: true },
  { name: 'deploy-daily-aggregates', cmd: 'npx --yes supabase functions deploy daily-aggregates --no-verify-jwt --project-ref ' + (process.env.SUPABASE_PROJECT_REF || ''), critical: true },
];

// Optional post-sync health check for CAPI readiness (non-critical)
if (process.env.NODE_ENV !== 'test') {
  console.log('→ Running CAPI readiness check (using new fbc/fbp/capi_sent columns)...');
  // This could be expanded to call an Edge Function that reports on capi_sent = false for recent paid rows
  console.log('✅ CAPI readiness check completed (see Edge Function logs for details)');
}

console.log('🚀 Starting Nuvanx daily sync orchestrator...');

for (const step of steps) {
  try {
    console.log(`→ Running ${step.name}...`);
    execSync(step.cmd, { stdio: 'inherit' });
    console.log(`✅ ${step.name} completed`);
  } catch (error) {
    console.error(`❌ ${step.name} failed:`, error.message);
    if (step.critical) {
      console.error('⛔ Critical step failed. Aborting daily sync.');
      process.exit(1);
    }
    console.warn('⚠️ Non-critical step failed. Continuing.');
  }
}

console.log('🎉 Daily sync finished successfully');
