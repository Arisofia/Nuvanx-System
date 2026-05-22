#!/usr/bin/env node
/**
 * Nuvanx Daily Sync Orchestrator
 * Runs core daily operational jobs with fail-fast semantics on critical steps.
 */

const { execSync } = require('child_process');

const steps = [
  { name: 'scan-secrets', cmd: 'node scripts/scan-secrets.js', critical: true },
  { name: 'verify-meta-access', cmd: 'node scripts/verify-meta-access.js', critical: true },
  { name: 'sync-doctoralia', cmd: 'node scripts/sync-doctoralia.js', critical: false },
  { name: 'deploy-daily-aggregates', cmd: 'supabase functions deploy daily-aggregates --no-verify-jwt', critical: true },
];

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
