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

test('Doctoralia appointments source is intrinsically pinned to Base Completa', () => {
  assert.equal(CANONICAL_DOCTORALIA_APPOINTMENTS_SHEET, 'Base Completa Doctoralia');
  assert.equal(resolveDoctoraliaAppointmentsSheetName({}), 'Base Completa Doctoralia');
  assert.equal(
    resolveDoctoraliaAppointmentsSheetName({ DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Base Completa Doctoralia' }),
    'Base Completa Doctoralia',
  );
});

test('no environment value can redirect the governed source', () => {
  for (const env of [
    { DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Doctoralia' },
    { DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Doctoralia', DOCTORALIA_ALLOW_NON_CANONICAL_SHEET: 'true' },
    { DOCTORALIA_APPOINTMENTS_SHEET_NAME: 'Listado' },
  ]) {
    const decision = getDoctoraliaAppointmentsSourceDecision(env);
    assert.equal(decision.resolved, 'Base Completa Doctoralia');
    assert.equal(decision.overrideAllowed, false);
    assert.equal(decision.nonCanonicalIgnored, true);
  }
});

test('canonical source authority belongs to the single appointments sync owner', () => {
  assert.match(syncOwner, /getDoctoraliaAppointmentsSourceDecision\(process\.env\)/);
  assert.match(syncOwner, /const SHEET_NAME = SOURCE_DECISION\.resolved/);
  assert.doesNotMatch(syncOwner, /DOCTORALIA_ALLOW_NON_CANONICAL_SHEET/);
  assert.doesNotMatch(syncOwner, /process\.env\.SHEET_NAME/);

  assert.match(orchestrator, /withEnv\('node scripts\/sync-doctoralia-appointments\.js'/);
  assert.doesNotMatch(orchestrator, /sync-doctoralia-appointments-canonical\.js/);

  assert.equal(packageJson.scripts['doctoralia:appointments:load'], 'npm run doctoralia:appointments:sync');
  assert.equal(packageJson.scripts['doctoralia:appointments:dry-run'], 'npm run doctoralia:appointments:sync:dry-run');
  assert.match(packageJson.scripts['doctoralia:appointments:sync'], /node scripts\/sync-doctoralia-appointments\.js$/);
  assert.match(packageJson.scripts['doctoralia:appointments:sync:dry-run'], /node scripts\/sync-doctoralia-appointments\.js --dry-run$/);
  assert.equal(existsSync('scripts/sync-doctoralia-appointments-canonical.js'), false);
});
