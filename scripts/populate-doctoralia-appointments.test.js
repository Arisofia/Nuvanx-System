#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  buildRecord,
  dedupeRecordsBySourceKey,
} = require('./populate-doctoralia-appointments.js');

const duplicateRecords = [
  { source_key: 'appointment:1', appointment_id: 'appointment:1', sheet_row: 2, value: 'first' },
  { source_key: 'appointment:2', appointment_id: 'appointment:2', sheet_row: 3, value: 'only' },
  { source_key: 'appointment:1', appointment_id: 'appointment:1', sheet_row: 4, value: 'last' },
];

assert.deepEqual(dedupeRecordsBySourceKey(duplicateRecords), [
  { source_key: 'appointment:1', appointment_id: 'appointment:1', sheet_row: 4, value: 'last' },
  { source_key: 'appointment:2', appointment_id: 'appointment:2', sheet_row: 3, value: 'only' },
]);

assert.throws(
  () => dedupeRecordsBySourceKey([{ sheet_row: 5, value: 'missing source key' }]),
  /every row must include source_key, appointment_id and integer sheet_row/,
);

const headerMap = {
  estado: 0,
  appointment_date: 1,
  appointment_time: 2,
  doctoralia_id: 3,
  patient_name: 4,
  phone: 5,
  treatment: 6,
};

const firstVisit = buildRecord([
  'Pendiente',
  '07/05/2026',
  '12:00 - 12:30',
  '48',
  'TERESA IZQUIERDO DE LAS HERAS',
  '600000000',
  'REVISIÓN TRATAMIENTO',
], headerMap, 1592);

const secondVisitSameDoctoraliaCode = buildRecord([
  'Pendiente',
  '21/05/2026',
  '17:15 - 17:30',
  '48',
  'TERESA IZQUIERDO DE LAS HERAS',
  '600000000',
  'BOTOX (NEUROMODULADOR)',
], headerMap, 1688);

assert.notEqual(firstVisit.source_key, secondVisitSameDoctoraliaCode.source_key);
assert.equal(firstVisit.appointment_id, firstVisit.source_key);
assert.equal(secondVisitSameDoctoraliaCode.appointment_id, secondVisitSameDoctoraliaCode.source_key);
assert.equal(firstVisit.doctoralia_id, '48');
assert.equal(firstVisit.is_control, false, 'Revisión tratamiento is a real appointment, not an internal control');

console.log('populate-doctoralia-appointments tests passed');
