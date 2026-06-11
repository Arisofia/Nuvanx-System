#!/usr/bin/env node
/**
 * Nuvanx Daily Sync Orchestrator
 * Runs core daily operational jobs with fail-fast semantics on critical steps.
 */

const { execSync } = require('child_process');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function requireProjectRefWhenDeploying() {
  const ref = String(process.env.SUPABASE_PROJECT_REF || '').trim();
  if (!ref) {
    throw new Error('SUPABASE_PROJECT_REF is required when DAILY_SYNC_DEPLOY_FUNCTIONS=true.');
  }
  return ref;
}

const steps = [
  { name: 'scan-secrets', cmd: 'node scripts/scan-secrets.js', critical: true },
  { name: 'verify-meta-access', cmd: 'node scripts/verify-meta-access.js', critical: true },
  { name: 'sync-doctoralia', cmd: 'node scripts/sync-doctoralia.js', critical: false },
  {
    name: 'sync-doctoralia-appointments',
    cmd: 'node scripts/sync-doctoralia-appointments.js',
    critical: false,
    skipReason: 'Doctoralia sheet sync failure must not block Meta insights or other operational steps.',
  },
  {
    name: 'deploy-daily-aggregates',
    cmd: () => 'npx --yes supabase --yes functions deploy daily-aggregates --no-verify-jwt --project-ref ' + requireProjectRefWhenDeploying(),
    critical: true,
    retry: 2,
    enabled: process.env.DAILY_SYNC_DEPLOY_FUNCTIONS === 'true',
    skipReason: 'Edge Function deployment is handled by the Deploy Supabase workflow. Set DAILY_SYNC_DEPLOY_FUNCTIONS=true to deploy from daily sync.',
  },
];

console.log('Starting Nuvanx daily sync orchestrator...');

for (const step of steps) {
  if (step.enabled === false) {
    console.log(Skipping : );
    continue;
  }

  let attempt = 0;
  const maxAttempts = (step.retry || 0) + 1;
  let success = false;

  while (attempt < maxAttempts && !success) {
    try {
      attempt += 1;
      const command = typeof step.cmd === 'function' ? step.cmd() : step.cmd;

      if (maxAttempts > 1) {
        console.log(Running  (attempt /)...);
      } else {
        console.log(Running ...);
      }

      execSync(command, { stdio: 'inherit' });
      console.log(${step.name} completed);
      success = true;
    } catch (error) {
      console.error(${step.name} failed:, error.message);

      if (attempt < maxAttempts) {
        console.log(Retrying  in 10s...);
        sleep(10_000);
      } else if (step.critical) {
        console.error('Critical step failed after maximum attempts. Aborting daily sync.');
        process.exit(1);
      } else {
        console.warn('Non-critical step failed. Continuing.');
      }
    }
  }
}

console.log('Daily sync finished successfully');
