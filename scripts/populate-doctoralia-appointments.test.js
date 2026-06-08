#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  dedupeRecordsBySourceKey,
} = require('./populate-doctoralia-appointments.js');

const duplicateRecords = [
  { source_key: 'doctoralia:1', sheet_row: 2, value: 'first' },
  { source_key: 'doctoralia:2', sheet_row: 3, value: 'only' },
  { source_key: 'doctoralia:1', sheet_row: 4, value: 'last' },
];

assert.deepEqual(dedupeRecordsBySourceKey(duplicateRecords), [
  { source_key: 'doctoralia:1', sheet_row: 4, value: 'last' },
  { source_key: 'doctoralia:2', sheet_row: 3, value: 'only' },
]);

assert.throws(
  () => dedupeRecordsBySourceKey([{ sheet_row: 5, value: 'missing source key' }]),
  /every row must include source_key and integer sheet_row/
);

console.log('populate-doctoralia-appointments tests passed');
