'use strict';

const assert = require('node:assert/strict');
const { extractPhonesFromSubject, normalizePhoneForMatching } = require('./phone-normalization');

assert.equal(normalizePhoneForMatching('+34 612 345 678'), '612345678');
assert.equal(normalizePhoneForMatching('0034 612 345 678'), '612345678');
assert.equal(normalizePhoneForMatching('612 345 678'), '612345678');
assert.equal(normalizePhoneForMatching(''), null);

// Reject fake all-zero placeholders (common in Doctoralia/Listado bad exports)
assert.equal(normalizePhoneForMatching('000000000'), null);
assert.equal(normalizePhoneForMatching('0000000000'), null);
assert.equal(normalizePhoneForMatching('000000'), null);
assert.equal(normalizePhoneForMatching(' 000 000 000 '), null);

// Incomplete/short phones also rejected
assert.equal(normalizePhoneForMatching('63957707'), null); // 8 digits
assert.equal(normalizePhoneForMatching('12345'), null);

assert.deepEqual(extractPhonesFromSubject('Revision [657174670 - +34 612 345 678]'), ['657174670', '612345678']);
// Fake phones in subject should be dropped entirely
assert.deepEqual(extractPhonesFromSubject('Test [000000000 - 612345678]'), ['612345678']);

console.log('phone-normalization tests passed');
