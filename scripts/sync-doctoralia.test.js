'use strict';

const assert = require('node:assert/strict');
const {
  buildHeaderConfig,
  validateHeaderConfig,
  parseAmount,
  parseDate,
  parseStatus,
  detectHeaderRowIndex,
  resolveSheetTitle,
} = require('./sync-doctoralia');

const validHeaders = ['ID', 'Fecha', 'Hora', 'Plantilla', 'Fecha liquidación', 'Importe neto', 'Estado', 'Nombre'];
const config = validateHeaderConfig(buildHeaderConfig(validHeaders));
assert.equal(config.hasColNet, true);
assert.equal(resolveSheetTitle([
  { properties: { title: 'Base Completa Doctoralia' } },
  { properties: { title: 'Doctoralia' } },
], 'Doctoralia'), 'Doctoralia');
assert.equal(resolveSheetTitle([
  { properties: { title: 'Base Completa Doctoralia' } },
], 'Doctoralia'), 'Base Completa Doctoralia');
assert.equal(detectHeaderRowIndex([
  ['Listado de citas'],
  [null, 'Estado', null, 'Hora', 'Fecha creación', null, 'Asunto', 'Agenda', 'Importe'],
  [null, 'Pendiente', null, '12:00', '22/05/2026', null, '578. NOMBRE [612345678]', 'Agenda', '350'],
]), 1);
assert.notEqual(config.colSettledEff, -1);
assert.equal(parseAmount('1.234'), 1234);
assert.equal(parseAmount('1.234,56'), 1234.56);
assert.equal(parseAmount('1234,56 €'), 1234.56);
assert.equal(parseDate('22/08/2026').toISOString(), '2026-08-22T00:00:00.000Z');
assert.equal(parseStatus('Realizada', new Date()).statusType, 'completed');
assert.throws(
  () => validateHeaderConfig(buildHeaderConfig(['ID', 'Estado'])),
  /Encabezados Doctoralia incompletos/,
);
console.log('sync-doctoralia contract tests passed');
