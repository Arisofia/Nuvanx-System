#!/usr/bin/env node
'use strict';

/**
 * Nuvanx Daily Sync Orchestrator
 * Runs core daily operational jobs with fail-fast semantics on critical steps.
 * Function mutation stays with the governed Edge deploy owner, not this job.
 */

const { execSync } = require('child_process');

function resolveDoctoraliaAppointmentsSheetId() {
  const sheetId = String(
    process.env.DOCTORALIA_APPOINTMENTS_SHEET_ID ||
    process.env.DOCTORALIA_SHEET_ID ||
    process.env.DOCTORALIA_DRIVE_FILE_ID ||
    '',
  ).trim();

  if (!sheetId) {
    throw new Error('DOCTORALIA_APPOINTMENTS_SHEET_ID, DOCTORALIA_SHEET_ID, or DOCTORALIA_DRIVE_FILE_ID is required.');
  }

  return sheetId;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withEnv(command, env) {
  const assignments = Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join(' ');
  return `${assignments} ${command}`;
}

const doctoraliaAppointmentsEnv = {
  DOCTORALIA_APPOINTMENTS_SHEET_ID: resolveDoctoraliaAppointmentsSheetId(),
  DOCTORALIA_APPOINTMENTS_SHEET_NAME: String(process.env.DOCTORALIA_APPOINTMENTS_SHEET_NAME || 'Base Completa Doctoralia').trim(),
  DOCTORALIA_APPOINTMENTS_SHEET_RANGE: String(process.env.DOCTORALIA_APPOINTMENTS_SHEET_RANGE || 'A1:T5000').trim(),
  DOCTORALIA_APPOINTMENTS_MIN_ROWS: String(process.env.DOCTORALIA_APPOINTMENTS_MIN_ROWS || '1800').trim(),
  DOCTORALIA_APPOINTMENTS_PERMISSION_MODE: String(process.env.DOCTORALIA_APPOINTMENTS_PERMISSION_MODE || process.env.DOCTORALIA_SYNC_PERMISSION_MODE || 'fail').trim().toLowerCase(),
};

const steps = [
  { name: 'scan-secrets', cmd: 'node scripts/scan-secrets.js', critical: true },
  { name: 'verify-meta-access', cmd: 'node scripts/verify-meta-access.js', critical: true },
  { name: 'sync-google-ads', cmd: 'node scripts/sync-google-ads-via-edge.js', critical: true, retry: 1 },
  {
    name: 'sync-doctoralia-appointments',
    cmd: withEnv('node scripts/sync-doctoralia-appointments.js', doctoraliaAppointmentsEnv),
    critical: true,
    retry: 1,
  },
  {
    name: 'refresh-doctoralia-appointment-engine',
    cmd: 'node scripts/refresh-doctoralia-appointment-engine.js',
    critical: true,
    retry: 1,
  },
];

console.log('Starting Nuvanx daily sync orchestrator...');

for (const step of steps) {
  let attempt = 0;
  const maxAttempts = (step.retry || 0) + 1;
  let success = false;

  while (attempt < maxAttempts && !success) {
    try {
      attempt += 1;
      if (maxAttempts > 1) {
        console.log(`Running ${step.name} (attempt ${attempt}/${maxAttempts})...`);
      } else {
        console.log(`Running ${step.name}...`);
      }

      execSync(step.cmd, { stdio: 'inherit', shell: '/bin/bash' });
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
