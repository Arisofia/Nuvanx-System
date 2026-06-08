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
  {
    name: 'sync-doctoralia-appointments',
    cmd: 'node scripts/sync-doctoralia-appointments.js',
    // Non-critical: Doctoralia sheet sync failure must not block Meta insights or other steps.
    // Google Sheets 403/row-count mismatches are data-quality issues, not infrastructure failures.
    critical: false,
  },
  {
    name: 'deploy-daily-aggregates',
    cmd: 'npx --yes supabase --yes functions deploy daily-aggregates --no-verify-jwt --project-ref '
      + (process.env.SUPABASE_PROJECT_REF || ''),
    critical: true,
    retry: 2, // retry up to 2 times for transient network issues
    enabled: process.env.DAILY_SYNC_DEPLOY_FUNCTIONS === 'true',
    skipReason: 'Edge Function deployment is handled by the Deploy Supabase workflow. '
      + 'Set DAILY_SYNC_DEPLOY_FUNCTIONS=true to deploy from daily sync.',
  },
];

console.log('🚀 Starting Nuvanx daily sync orchestrator...');

for (const step of steps) {
  if (step.enabled === false) {
    console.log(`↷ Skipping ${step.name}: ${step.skipReason || 'step disabled'}`);
    continue;
  }

  let attempt = 0;
  const maxAttempts = (step.retry || 0) + 1;
  let success = false;

  while (attempt < maxAttempts && !success) {
    try {
      attempt++;
      if (maxAttempts > 1) {
        console.log(`→ Running ${step.name} (attempt ${attempt}/${maxAttempts})...`);
      } else {
        console.log(`→ Running ${step.name}...`);
      }
      execSync(step.cmd, { stdio: 'inherit' });
      console.log(`✅ ${step.name} completed`);
      success = true;
    } catch (error) {
      console.error(`❌ ${step.name} failed:`, error.message);
      if (attempt < maxAttempts) {
        console.log(`⚠️ Retrying ${step.name} in 10s...`);
        execSync('sleep 10');
      } else if (step.critical) {
        console.error('⛔ Critical step failed after maximum attempts. Aborting daily sync.');
        process.exit(1);
      } else {
        console.warn('⚠️ Non-critical step failed. Continuing.');
      }
    }
  }
}

console.log('🎉 Daily sync finished successfully');
