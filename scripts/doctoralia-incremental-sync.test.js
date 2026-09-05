'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const {
  buildStableAppointmentSourceKey,
  dedupeCanonicalRecords,
  planIncrementalChanges,
} = require('./lib/doctoralia-incremental-sync.js');

function appointment(overrides = {}) {
  return {
    source_key: 'legacy-v2',
    appointment_id: 'legacy-v2',
    sheet_row: 100,
    doctoralia_id: '155',
    patient_name: 'PACIENTE PRUEBA',
    phone: '612345678',
    patient_phone: '612345678',
    phone_normalized: '612345678',
    appointment_date: '2026-09-10',
    appointment_time: '12:00 - 12:30',
    agenda: 'MEDICINA ESTÉTICA JJRT',
    estado: 'Pendiente',
    status: 'Pendiente',
    treatment: 'Primera visita',
    appointment_type: 'Primera visita',
    amount: 0,
    clinic: 'Centro Clínico NUVANX Chamberí',
    is_cancelled: false,
    is_jjrt: true,
    is_nursing: false,
    is_control: false,
    raw_data: { source_key_version: 2 },
    ...overrides,
  };
}

test('stable key ignores lifecycle fields and source row position', () => {
  const first = appointment();
  const laterSnapshot = appointment({
    sheet_row: 900,
    estado: 'Anulada',
    status: 'Anulada',
    treatment: 'REVISIÓN TRATAMIENTO',
    appointment_type: 'REVISIÓN TRATAMIENTO',
    amount: 350,
    is_cancelled: true,
  });

  assert.equal(
    buildStableAppointmentSourceKey(first),
    buildStableAppointmentSourceKey(laterSnapshot),
  );
});

test('different appointment slot remains a different appointment', () => {
  const first = appointment();
  const nextVisit = appointment({
    appointment_date: '2026-09-17',
  });

  assert.notEqual(
    buildStableAppointmentSourceKey(first),
    buildStableAppointmentSourceKey(nextVisit),
  );
});

test('latest source snapshot wins before persistence', () => {
  const canonical = dedupeCanonicalRecords([
    appointment({ sheet_row: 10, estado: 'Pendiente', status: 'Pendiente' }),
    appointment({ sheet_row: 11, estado: 'Anulada', status: 'Anulada', is_cancelled: true }),
  ]);

  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].sheet_row, 11);
  assert.equal(canonical[0].estado, 'Anulada');
  assert.match(canonical[0].source_key, /^doctoralia_appt_v3:[0-9a-f]{64}$/);
  assert.equal(canonical[0].appointment_id, canonical[0].source_key);
  assert.equal(canonical[0].raw_data.source_key_version, 3);
});

test('incremental planner writes only missing or changed appointments', () => {
  const [unchanged, changed, missing] = dedupeCanonicalRecords([
    appointment({ doctoralia_id: '1', appointment_date: '2026-09-10' }),
    appointment({ doctoralia_id: '2', appointment_date: '2026-09-11', estado: 'Anulada', status: 'Anulada', is_cancelled: true }),
    appointment({ doctoralia_id: '3', appointment_date: '2026-09-12' }),
  ]);

  const existing = new Map([
    [unchanged.source_key, { ...unchanged, sheet_row: 1, raw_data: null }],
    [changed.source_key, { ...changed, estado: 'Pendiente', status: 'Pendiente', is_cancelled: false }],
  ]);

  const plan = planIncrementalChanges([unchanged, changed, missing], existing);
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.updates[0].source_key, changed.source_key);
  assert.equal(plan.inserts[0].source_key, missing.source_key);
});

test('stable identity uses SHA-256 and contains no weak MD5 path', () => {
  const incrementalSource = readFileSync('scripts/lib/doctoralia-incremental-sync.js', 'utf8');
  assert.match(incrementalSource, /createHash\('sha256'\)/);
  assert.doesNotMatch(incrementalSource, /createHash\(['"]md5['"]\)/i);
});

test('governed owners contain no destructive Doctoralia path', () => {
  const syncOwner = readFileSync('scripts/sync-doctoralia-appointments.js', 'utf8');
  const dailyOwner = readFileSync('scripts/run-daily-sync.js', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');
  const migration = readFileSync(
    'supabase/migrations/20260905193000_incremental_doctoralia_and_financial_boundary.sql',
    'utf8',
  );

  assert.match(syncOwner, /syncIncrementalAppointments/);
  assert.doesNotMatch(syncOwner, /replaceMode\s*:\s*true/);
  assert.doesNotMatch(dailyOwner, /sync-doctoralia\.js/);
  assert.doesNotMatch(dailyOwner, /DOCTORALIA_APPOINTMENTS_REPLACE_MODE/);
  assert.doesNotMatch(packageJson, /sync-doctoralia\.test\.js/);
  assert.doesNotMatch(packageJson, /DOCTORALIA_APPOINTMENTS_REPLACE_MODE=true/);

  assert.match(migration, /drop constraint if exists doctoralia_appointments_ingestion_sheet_row_key/i);
  assert.match(migration, /trg_guard_doctoralia_appointment_delete/i);
  assert.match(migration, /financial_settlements_no_doctoralia_appointment_materialization/i);
  assert.match(migration, /extensions\.digest/i);
  assert.doesNotMatch(migration, /pg_catalog\.md5/i);
  assert.doesNotMatch(migration, /doctoralia_appointment_value_materialization/i);
});
