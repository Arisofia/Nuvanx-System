'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  refreshConfigState,
  runPreflight,
} = require('./google-ads-auth-preflight');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

test('refresh configuration is absent, partial or complete without exposing values', () => {
  assert.equal(refreshConfigState({}), 'absent');
  assert.equal(refreshConfigState({ GOOGLE_ADS_CLIENT_ID: 'id-only' }), 'partial');
  assert.equal(refreshConfigState({
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
  }), 'complete');
});

test('preflight fails closed on a partial OAuth refresh tuple before provider calls', async () => {
  let calls = 0;
  const result = await runPreflight({
    env: {
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network should not be reached');
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'partial_oauth_refresh_configuration');
  assert.equal(calls, 0);
});

test('OAuth refresh mode is operative only after listAccessibleCustomers and both read-only GAQL probes pass', async () => {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = String(options.body || '');
      assert.match(body, /grant_type=refresh_token/);
      return jsonResponse({ access_token: 'ephemeral-access-token' });
    }
    if (url.endsWith('/customers:listAccessibleCustomers')) {
      assert.equal(options.headers.Authorization, 'Bearer ephemeral-access-token');
      assert.equal(options.headers['developer-token'], 'developer-token');
      return jsonResponse({
        resourceNames: [
          'customers/8265708501',
          'customers/9999999999',
        ],
      });
    }
    const match = url.match(/\/customers\/(\d+)\/googleAds:search$/);
    if (match) {
      const customerId = match[1];
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['login-customer-id'], '8265708501');
      assert.deepEqual(JSON.parse(options.body), { query: 'SELECT customer.id FROM customer LIMIT 1' });
      return jsonResponse({ results: [{ customer: { id: customerId } }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await runPreflight({
    env: {
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
    },
    fetchImpl,
  });

  assert.equal(result.success, true);
  assert.equal(result.recommended_auth_mode, 'oauth_refresh');
  assert.deepEqual(result.target_customer_ids, ['9084540447', '8201489748']);
  assert.equal(result.probes[0].operative, true);
  assert.equal(result.probes[0].list_accessible.accessible_customer_count, 2);
  assert.equal(result.probes[0].list_accessible.login_customer_accessible, true);
  assert.equal(result.probes[0].customer_probes.length, 2);
  assert.equal(seen.length, 4);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /ephemeral-access-token|client-secret|refresh-token|developer-token/);
  assert.doesNotMatch(serialized, /9999999999|accessible_customer_ids/);
});

test('provider 401 is reported as bounded diagnostic metadata without leaking credentials', async () => {
  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'do-not-leak-token' });
    return jsonResponse({ error: { status: 'UNAUTHENTICATED', message: 'sensitive provider body' } }, 401);
  };

  const result = await runPreflight({
    env: {
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
    },
    fetchImpl,
  });

  assert.equal(result.success, false);
  assert.equal(result.probes[0].list_accessible.http_status, 401);
  assert.equal(result.probes[0].list_accessible.provider_status, 'UNAUTHENTICATED');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /do-not-leak-token|client-secret|refresh-token|developer-token|sensitive provider body/);
});
