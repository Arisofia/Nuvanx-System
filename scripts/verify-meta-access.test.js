#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_META_GRAPH_VERSION,
  MetaApiError,
  createMetaUrl,
  getMetaGraphVersion,
  isPermissionError,
  mapWithConcurrency,
  normalizeAdAccountId,
  parseTargetAdAccountIds,
} = require('./verify-meta-access');

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.META_GRAPH_VERSION;
  delete process.env.META_APP_SECRET;
}

async function main() {
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

  assert.equal(isPermissionError(new MetaApiError('denied', { status: 403 })), true);
  assert.equal(isPermissionError(new MetaApiError('expired', { body: { error: { code: 190 } } })), true);
  assert.equal(isPermissionError(new MetaApiError('network', { code: 'NETWORK_ERROR' })), false);
  assert.equal(isPermissionError(new MetaApiError('unavailable', { status: 503 })), false);

  let active = 0;
  let peak = 0;
  const doubled = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(doubled, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);

  resetEnv();
  console.log('verify-meta-access tests passed');
}

main().catch((error) => {
  resetEnv();
  console.error(error);
  process.exit(1);
});
