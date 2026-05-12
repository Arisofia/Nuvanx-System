'use strict';

const assert = require('node:assert/strict');
const { extractPhonesFromSubject, normalizePhoneForMatching } = require('./phone-normalization');

assert.equal(normalizePhoneForMatching('+34 612 345 678'), '612345678');
assert.equal(normalizePhoneForMatching('0034 612 345 678'), '612345678');
assert.equal(normalizePhoneForMatching('612 345 678'), '612345678');
assert.equal(normalizePhoneForMatching(''), null);
assert.deepEqual(extractPhonesFromSubject('Revision [657174670 - +34 612 345 678]'), ['657174670', '612345678']);

console.log('phone-normalization tests passed');
