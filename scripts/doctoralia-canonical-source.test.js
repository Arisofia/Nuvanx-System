'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const test = require('node:test');
const {
  CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET,
  getDoctoraliaAppointmentsSourceDecision,
  resolveDoctoraliaAppointmentsSheetName,
} = require('./lib/doctoralia-appointments-source.js');

const syncOwner = readFileSync('scripts/sync-doctoralia-appointments.js', 'utf8');
const orchestrator = readFileSync('scripts/run-daily-sync.js', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

test('Doctoralia appointments source is pinned to Base Completa by default', () => {
  assert.equal(CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET, 'Base Completa Doctoralia');
  assert.equal(resolveDoctoraliaAppointmentsSheetName({}), 'Base Completa Doctoralia');
  assert.equal(
    resolveDoctoraliaAppointmentsSheetName({
      DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Base Completa Doctoralia',
    }),
    'Base Completa Doctoralia',
  );
});

test('legacy Doctoralia sheet configuration cannot override the governed source implicitly', () => {
  const decision = getDoctoraliaAppointmentsSourceDecision({
    DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Doctoralia',
  });

  assert.equal(decision.requested, 'Doctoralia');
  assert.equal(decision.resolved, 'Base Completa Doctoralia');
  assert.equal(decision.nonCanonicalIgnored, true);
  assert.equal(decision.overrideAllowed, false);
});

test('non-canonical source requires the explicit controlled-migration escape hatch', () => {
  const decision = getDoctoraliaAppointmentsSourceDecision({
    DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Doctoralia',
    DOCTORALIA_ALLOW_NON_CANONICAL_SHEET: 'true',
  });

  assert.equal(decision.resolved, 'Doctoralia');
  assert.equal(decision.overrideAllowed, true);
  assert.equal(decision.nonCanonicalIgnored, false);
});

test('canonical source authority is intrinsic to the single appointments sync owner', () => {
  assert.match(syncOwner, /getDoctoraliaAppointmentsSourceDecision\(process\.env\)/);
  assert.match(syncOwner, /const SHEET_NAME = SOURCE_DECISION\.resolved/);
  assert.doesNotMatch(syncOwner, /process\.env\.SHEET_NAME/);

  assert.match(
    orchestrator,
    /withEnv\('node scripts\/sync-doctoralia-appointments\.js'/,
  );
  assert.doesNotMatch(orchestrator, /sync-doctoralia-appointments-canonical\.js/);

  assert.match(
    packageJson.scripts['doctoralia:appointments:sync'],
    /node scripts\/sync-doctoralia-appointments\.js$/,
  );
  assert.match(
    packageJson.scripts['doctoralia:appointments:sync:dry-run'],
    /node scripts\/sync-doctoralia-appointments\.js --dry-run$/,
  );

  assert.equal(existsSync('scripts/sync-doctoralia-appointments-canonical.js'), false);
});
