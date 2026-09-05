#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  buildHeaderMap,
  buildRecord,
  dedupeRecordsBySourceKey,
  findHeaderRowIndex,
  recordsFromRows,
} = require('./populate-doctoralia-appointments.js');
const { buildStableAppointmentSourceKey } = require('./lib/doctoralia-incremental-sync.js');

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
  agenda: 7,
};

const firstVisit = buildRecord([
  'Pendiente',
  '07/05/2026',
  '12:00 - 12:30',
  '48',
  'PACIENTE DEMO A',
  '600000000',
  'REVISIÓN TRATAMIENTO',
  'MEDICINA ESTÉTICA JJRT',
], headerMap, 1592);

const secondVisitSameDoctoraliaCode = buildRecord([
  'Pendiente',
  '21/05/2026',
  '17:15 - 17:30',
  '48',
  'PACIENTE DEMO A',
  '600000000',
  'BOTOX (NEUROMODULADOR)',
  'MEDICINA ESTÉTICA JJRT',
], headerMap, 1688);

assert.notEqual(firstVisit.source_key, secondVisitSameDoctoraliaCode.source_key);
assert.equal(firstVisit.appointment_id, firstVisit.source_key);
assert.equal(secondVisitSameDoctoraliaCode.appointment_id, secondVisitSameDoctoraliaCode.source_key);
assert.equal(firstVisit.doctoralia_id, '48');
assert.equal(firstVisit.is_control, false, 'Revisión tratamiento is a real appointment, not an internal control');

const malformedHistorical = buildRecord([
  'Pendiente',
  '23/04/2026',
  '16:00 - 18:00',
  '',
  '',
  '',
  'O/1. REGISTRO HISTÓRICO [612345678] (REVISIÓN TRATAMIENTO)',
  'MEDICINA ESTÉTICA JJRT',
], headerMap, 2000);
assert.equal(malformedHistorical.doctoralia_id, null);
assert.equal(malformedHistorical.patient_name, null);
assert.equal(malformedHistorical.phone, '612345678');
assert.equal(malformedHistorical.phone_normalized, '612345678');
assert.match(buildStableAppointmentSourceKey(malformedHistorical), /^doctoralia_appt_v3:[0-9a-f]{64}$/);

const baseCompletaHeaders = [
  'Nº Historia',
  'Paciente',
  'Teléfono paciente',
  'Estado',
  'Fecha',
  'Hora',
  'Fecha creación',
  'Concepto cita',
  'Agenda',
  'Sala/Box',
  'Confirmada',
  'Procedencia',
  'Importe',
];
const baseCompletaHeaderMap = buildHeaderMap(baseCompletaHeaders);
assert.equal(baseCompletaHeaderMap.doctoralia_id, 0);
assert.equal(baseCompletaHeaderMap.patient_name, 1);
assert.equal(baseCompletaHeaderMap.phone, 2);
assert.equal(baseCompletaHeaderMap.estado, 3);
assert.equal(baseCompletaHeaderMap.appointment_date, 4);
assert.equal(baseCompletaHeaderMap.appointment_time, 5);
assert.equal(baseCompletaHeaderMap.created_date, 6);
assert.equal(baseCompletaHeaderMap.treatment, 7);
assert.equal(baseCompletaHeaderMap.agenda, 8);
assert.equal(baseCompletaHeaderMap.room, 9);
assert.equal(baseCompletaHeaderMap.confirmed, 10);
assert.equal(baseCompletaHeaderMap.origin, 11);
assert.equal(baseCompletaHeaderMap.amount, 12);
assert.equal(baseCompletaHeaderMap.created_time, undefined, 'Hora must not impersonate Hora creación');
assert.equal(baseCompletaHeaderMap.normalized_date, undefined, 'Fecha must not impersonate Fecha para normalizar');

const baseCompletaRows = [
  ['CITAS CLINIC CLOUD'],
  baseCompletaHeaders,
  ['99', 'PACIENTE DE PRUEBA', '600000000', 'Pendiente', '21/08/2026', '10:00 - 10:30', '20/08/2026', 'BOTOX', 'MEDICINA ESTÉTICA JJRT', 'Sin asignar', '', '-', '270.00'],
  baseCompletaHeaders,
];

assert.equal(findHeaderRowIndex(baseCompletaRows), 1);
const baseCompletaRecords = recordsFromRows(baseCompletaRows);
assert.equal(baseCompletaRecords.length, 1, 'Embedded repeated header rows must be ignored');
assert.equal(baseCompletaRecords[0].doctoralia_id, '99');
assert.equal(baseCompletaRecords[0].patient_name, 'PACIENTE DE PRUEBA');
assert.equal(baseCompletaRecords[0].treatment, 'BOTOX');
assert.equal(baseCompletaRecords[0].amount, 270);
assert.equal(baseCompletaRecords[0].sheet_row, 3);
assert.equal(baseCompletaRecords[0].created_date, '2026-08-20');
assert.equal(baseCompletaRecords[0].created_time, null);
assert.equal(baseCompletaRecords[0].normalized_date, '2026-08-21');

console.log('populate-doctoralia-appointments tests passed');
