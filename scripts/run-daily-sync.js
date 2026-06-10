#!/usr/bin/env node
/**
 * Nuvanx Daily Sync Orchestrator
 * Runs core daily operational jobs with fail-fast semantics on critical steps.
 */

const { execSync } = require('child_process');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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
      + (() => { const ref = String(process.env.SUPABASE_PROJECT_REF || '').trim(); if (!ref) throw new Error('SUPABASE_PROJECT_REF is required when DAILY_SYNC_DEPLOY_FUNCTIONS=true.'); return ref; })(),
    critical: true,
    retry: 2, // retry up to 2 times for transient network issues
    enabled: process.env.DAILY_SYNC_DEPLOY_FUNCTIONS === 'true',
    skipReason: 'Edge Function deployment is handled by the Deploy Supabase workflow. '
      + 'Set DAILY_SYNC_DEPLOY_FUNCTIONS=true to deploy from daily sync.',
  },
];

console.log('ðŸš€ Starting Nuvanx daily sync orchestrator...');

for (const step of steps) {
  if (step.enabled === false) {
    console.log(`â†· Skipping ${step.name}: ${step.skipReason || 'step disabled'}`);
    continue;
  }

  let attempt = 0;
  const maxAttempts = (step.retry || 0) + 1;
  let success = false;

  while (attempt < maxAttempts && !success) {
    try {
      attempt++;
      if (maxAttempts > 1) {
        console.log(`â†’ Running ${step.name} (attempt ${attempt}/${maxAttempts})...`);
      } else {
        console.log(`â†’ Running ${step.name}...`);
      }
      execSync(step.cmd, { stdio: 'inherit' });
      console.log(`âœ… ${step.name} completed`);
      success = true;
    } catch (error) {
      console.error(`âŒ ${step.name} failed:`, error.message);
      if (attempt < maxAttempts) {
        console.log(`âš ï¸ Retrying ${step.name} in 10s...`);
        sleep(10_000);
      } else if (step.critical) {
        console.error('â›” Critical step failed after maximum attempts. Aborting daily sync.');
        process.exit(1);
      } else {
        console.warn('âš ï¸ Non-critical step failed. Continuing.');
      }
    }
  }
}

console.log('ðŸŽ‰ Daily sync finished successfully');
