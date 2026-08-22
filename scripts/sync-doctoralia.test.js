'use strict';

const assert = require('node:assert/strict');
const {
  buildHeaderConfig,
  validateHeaderConfig,
  parseAmount,
  parseDate,
  parseStatus,
} = require('./sync-doctoralia');

const validHeaders = ['ID', 'Fecha', 'Hora', 'Plantilla', 'Fecha liquidación', 'Importe neto', 'Estado', 'Nombre'];
const config = validateHeaderConfig(buildHeaderConfig(validHeaders));
assert.equal(config.hasColNet, true);
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
