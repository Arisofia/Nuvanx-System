#!/usr/bin/env node
'use strict';

/**
 * Nuvanx Daily Sync Orchestrator
 * Runs core daily operational jobs with fail-fast semantics on critical steps.
 */

const { execSync } = require('child_process');

const CANONICAL_DOCTORALIA_SHEET_ID = '1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw';

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

function withEnv(command, env) {
  const assignments = Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(' ');
  return `${assignments} ${command}`;
}

const doctoraliaAppointmentsEnv = {
  DOCTORALIA_APPOINTMENTS_SHEET_ID: CANONICAL_DOCTORALIA_SHEET_ID,
  DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Doctoralia',
  DOCTORALIA_APPOINTMENTS_SHEET_RANGE: 'A1:T5000',
  DOCTORALIA_APPOINTMENTS_MIN_ROWS: '1800',
  DOCTORALIA_APPOINTMENTS_PERMISSION_MODE: 'fail',
  DOCTORALIA_APPOINTMENTS_REPLACE_MODE: 'true',
};

const steps = [
  { name: 'scan-secrets', cmd: 'node scripts/scan-secrets.js', critical: true },
  { name: 'verify-meta-access', cmd: 'node scripts/verify-meta-access.js', critical: true },
  { name: 'sync-doctoralia', cmd: 'node scripts/sync-doctoralia.js', critical: false },
  {
    name: 'sync-doctoralia-appointments',
    cmd: withEnv('node scripts/sync-doctoralia-appointments.js', doctoraliaAppointmentsEnv),
    critical: true,
    retry: 1,
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
    console.log(`Skipping ${step.name}: ${step.skipReason}`);
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
        console.log(`Running ${step.name} (attempt ${attempt}/${maxAttempts})...`);
      } else {
        console.log(`Running ${step.name}...`);
      }

      execSync(command, { stdio: 'inherit', shell: '/bin/bash' });
      console.log(`${step.name} completed`);
      success = true;
    } catch (error) {
      console.error(`${step.name} failed:`, error.message);

      if (attempt < maxAttempts) {
        console.log(`Retrying ${step.name} in 10s...`);
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
