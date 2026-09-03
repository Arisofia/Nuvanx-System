'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CANONICAL_LOGIN_CUSTOMER_ID,
  TARGET_CUSTOMER_IDS,
  classifyFailureDiagnostic,
  preflightGoogleAdsRuntime,
} = require('./preflight-google-ads-runtime');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function successfulPayload(overrides = {}) {
  return {
    success: true,
    auth_mode: 'oauth_refresh',
    login_customer_id: CANONICAL_LOGIN_CUSTOMER_ID,
    login_customer_accessible: true,
    target_customer_ids: TARGET_CUSTOMER_IDS,
    customer_proofs: TARGET_CUSTOMER_IDS.map((customer_id) => ({ customer_id, identity_match: true })),
    accessible_customer_count: 3,
    persistence_performed: false,
    ...overrides,
  };
}

test('runtime preflight sends only the developer token to the authenticated Edge boundary', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      return response(200, 'internal-runtime-secret');
    }
    if (url.endsWith('/functions/v1/google-ads-auth-preflight')) {
      const body = JSON.parse(String(options.body || '{}'));
      assert.deepEqual(body, { developer_token: 'developer-token' });
      assert.equal(options.headers['x-nvx-internal-secret'], 'internal-runtime-secret');
      assert.equal(options.headers.Authorization, 'Bearer service-role-key');
      assert.equal(Object.hasOwn(body, 'oauth_client_id'), false);
      assert.equal(Object.hasOwn(body, 'oauth_refresh_token'), false);
      assert.equal(Object.hasOwn(body, 'service_account'), false);
      return response(200, successfulPayload());
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await preflightGoogleAdsRuntime({
    base: 'https://project.supabase.co',
    serviceRole: 'service-role-key',
    developerToken: 'developer-token',
    fetchImpl,
  });

  assert.equal(result.success, true);
  assert.equal(result.auth_mode, 'oauth_refresh');
  assert.equal(result.login_customer_id, CANONICAL_LOGIN_CUSTOMER_ID);
  assert.equal(result.login_customer_accessible, true);
  assert.equal(result.persistence_performed, false);
  assert.equal(calls.length, 2);
});

test('runtime preflight fails closed if Edge does not prove read-only semantics', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(200, successfulPayload({ persistence_performed: true }));
  };

  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    /read-only semantics/,
  );
});

test('runtime preflight fails closed unless both canonical customer identities are proven', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(200, successfulPayload({
      customer_proofs: [{ customer_id: TARGET_CUSTOMER_IDS[0], identity_match: true }],
    }));
  };

  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    /did not prove both customer identities/,
  );
});

test('runtime preflight rejects a non-canonical login customer id even if both target accounts are proven', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(200, successfulPayload({ login_customer_id: '1234567890' }));
  };

  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    /canonical MCC mismatch/,
  );
});

test('runtime preflight rejects success when the canonical MCC is not directly accessible', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(200, successfulPayload({ login_customer_accessible: false }));
  };

  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    /did not prove canonical MCC access/,
  );
});

test('runtime preflight maps bounded Edge configuration failures to stable secretless diagnostics', async () => {
  const payload = {
    success: false,
    kind: 'configuration',
    message: 'Google Ads OAuth refresh configuration is incomplete',
    persistence_performed: false,
  };
  assert.deepEqual(classifyFailureDiagnostic(payload), {
    kind: 'configuration',
    diagnostic: 'oauth_refresh_incomplete',
  });

  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(500, payload);
  };
  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    /kind=configuration, diagnostic=oauth_refresh_incomplete/,
  );
});

test('runtime preflight never emits an unrecognized Edge message or embedded secret', async () => {
  const secret = 'super-secret-value-that-must-not-appear';
  const payload = {
    success: false,
    kind: 'configuration',
    message: `unexpected failure ${secret}`,
    persistence_performed: false,
  };
  assert.deepEqual(classifyFailureDiagnostic(payload), {
    kind: 'configuration',
    diagnostic: 'configuration_unknown',
  });

  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(500, payload);
  };
  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /diagnostic=configuration_unknown/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test('runtime preflight allowlists Edge failure kinds and cannot echo an untrusted kind', async () => {
  const secret = 'kind-secret-that-must-not-appear';
  const payload = {
    success: false,
    kind: `configuration_${secret}`,
    message: 'unexpected failure',
    persistence_performed: false,
  };
  assert.deepEqual(classifyFailureDiagnostic(payload), {
    kind: 'unknown',
    diagnostic: 'unknown_unknown',
  });

  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(500, payload);
  };
  await assert.rejects(
    preflightGoogleAdsRuntime({
      base: 'https://project.supabase.co',
      serviceRole: 'service-role-key',
      developerToken: 'developer-token',
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /kind=unknown, diagnostic=unknown_unknown/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
