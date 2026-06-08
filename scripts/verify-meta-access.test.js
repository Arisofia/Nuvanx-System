#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_META_GRAPH_VERSION,
  createMetaUrl,
  getMetaGraphVersion,
  normalizeAdAccountId,
  parseTargetAdAccountIds,
} = require('./verify-meta-access');

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.META_GRAPH_VERSION;
  delete process.env.META_APP_SECRET;
}

resetEnv();
assert.equal(getMetaGraphVersion(), DEFAULT_META_GRAPH_VERSION);

process.env.META_GRAPH_VERSION = 'v21.0';
assert.equal(getMetaGraphVersion(), 'v21.0');

resetEnv();
assert.equal(normalizeAdAccountId('123'), 'act_123');
assert.equal(normalizeAdAccountId('act_456'), 'act_456');
assert.equal(normalizeAdAccountId(''), '');

assert.deepEqual(
  parseTargetAdAccountIds({
    META_AD_ACCOUNT_IDS: '123, act_456,123',
    META_AD_ACCOUNT_ID: '789',
    FALLBACK_META_AD_ACCOUNT_ID: '456',
  }),
  ['act_123', 'act_456', 'act_789'],
);

assert.deepEqual(
  parseTargetAdAccountIds({
    FALLBACK_META_AD_ACCOUNT_ID: '999',
  }),
  ['act_999'],
);

const url = createMetaUrl('/act_123', 'token');
assert.equal(url.origin, 'https://graph.facebook.com');
assert.equal(url.pathname, `/${DEFAULT_META_GRAPH_VERSION}/act_123`);
assert.equal(url.searchParams.get('access_token'), 'token');

resetEnv();
console.log('verify-meta-access tests passed');
