'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const test = require('node:test');
const {
  refreshConfigState,
  runPreflight,
  selectedAuthMode,
} = require('./google-ads-auth-preflight');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function serviceAccountJson() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    type: 'service_account',
    client_email: 'preflight-test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

test('refresh configuration and runtime-selected auth mode are deterministic without exposing values', () => {
  assert.equal(refreshConfigState({}), 'absent');
  assert.equal(refreshConfigState({ GOOGLE_ADS_CLIENT_ID: 'id-only' }), 'partial');
  assert.equal(refreshConfigState({
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
  }), 'complete');

  assert.equal(selectedAuthMode({}), null);
  assert.equal(selectedAuthMode({ GOOGLE_ADS_CLIENT_ID: 'id-only', GOOGLE_ADS_SERVICE_ACCOUNT: 'present' }), null);
  assert.equal(selectedAuthMode({ GOOGLE_ADS_SERVICE_ACCOUNT: 'present' }), 'service_account');
  assert.equal(selectedAuthMode({
    GOOGLE_ADS_CLIENT_ID: 'client-id',
    GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
    GOOGLE_ADS_SERVICE_ACCOUNT: 'present',
  }), 'oauth_refresh');
});

test('preflight fails closed on a partial OAuth refresh tuple before provider calls', async () => {
  let calls = 0;
  const result = await runPreflight({
    env: {
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_SERVICE_ACCOUNT: 'must-not-fallback',
    },
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network should not be reached');
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'partial_oauth_refresh_configuration');
  assert.equal(result.selected_auth_mode, null);
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
      return jsonResponse({ resourceNames: ['customers/8265708501', 'customers/9999999999'] });
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
  assert.equal(result.selected_auth_mode, 'oauth_refresh');
  assert.equal(result.reason, 'selected_runtime_auth_mode_provider_read_proof_passed');
  assert.deepEqual(result.diagnostic_operative_modes, ['oauth_refresh']);
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

test('an operative service account cannot mask failure of a configured OAuth refresh runtime identity', async () => {
  const serviceAccount = serviceAccountJson();
  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = String(options.body || '');
      if (body.includes('grant_type=refresh_token')) return jsonResponse({ access_token: 'oauth-access' });
      if (body.includes('jwt-bearer')) return jsonResponse({ access_token: 'service-access' });
      throw new Error('Unexpected OAuth grant');
    }
    if (options.headers.Authorization === 'Bearer oauth-access') {
      return jsonResponse({ error: { status: 'UNAUTHENTICATED', message: 'oauth identity denied' } }, 401);
    }
    if (url.endsWith('/customers:listAccessibleCustomers')) {
      return jsonResponse({ resourceNames: ['customers/8265708501'] });
    }
    const match = url.match(/\/customers\/(\d+)\/googleAds:search$/);
    if (match) return jsonResponse({ results: [{ customer: { id: match[1] } }] });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await runPreflight({
    env: {
      GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
      GOOGLE_ADS_CLIENT_ID: 'client-id',
      GOOGLE_ADS_CLIENT_SECRET: 'client-secret',
      GOOGLE_ADS_REFRESH_TOKEN: 'refresh-token',
      GOOGLE_ADS_SERVICE_ACCOUNT: serviceAccount,
    },
    fetchImpl,
  });

  assert.equal(result.selected_auth_mode, 'oauth_refresh');
  assert.equal(result.success, false);
  assert.equal(result.reason, 'selected_runtime_auth_mode_failed_provider_read_proof');
  assert.deepEqual(result.diagnostic_operative_modes, ['service_account']);
  assert.equal(result.probes.find((probe) => probe.mode === 'oauth_refresh').operative, false);
  assert.equal(result.probes.find((probe) => probe.mode === 'service_account').operative, true);
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
  assert.equal(result.selected_auth_mode, 'oauth_refresh');
  assert.equal(result.probes[0].list_accessible.http_status, 401);
  assert.equal(result.probes[0].list_accessible.provider_status, 'UNAUTHENTICATED');
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /do-not-leak-token|client-secret|refresh-token|developer-token|sensitive provider body/);
});
