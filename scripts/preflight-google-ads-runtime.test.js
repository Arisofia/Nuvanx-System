'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TARGET_CUSTOMER_IDS,
  preflightGoogleAdsRuntime,
} = require('./preflight-google-ads-runtime');

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

test('runtime preflight sends only the developer token to the authenticated Edge boundary', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
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
      return response(200, {
        success: true,
        auth_mode: 'oauth_refresh',
        login_customer_id: '8265708501',
        target_customer_ids: TARGET_CUSTOMER_IDS,
        customer_proofs: TARGET_CUSTOMER_IDS.map((customer_id) => ({ customer_id, identity_match: true })),
        accessible_customer_count: 3,
        persistence_performed: false,
      });
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
  assert.equal(result.persistence_performed, false);
  assert.equal(calls.length, 2);
});

test('runtime preflight fails closed if Edge does not prove read-only semantics', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return response(200, 'internal-runtime-secret');
    return response(200, {
      success: true,
      auth_mode: 'service_account',
      login_customer_id: '8265708501',
      target_customer_ids: TARGET_CUSTOMER_IDS,
      customer_proofs: TARGET_CUSTOMER_IDS.map((customer_id) => ({ customer_id, identity_match: true })),
      persistence_performed: true,
    });
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
    return response(200, {
      success: true,
      auth_mode: 'oauth_refresh',
      login_customer_id: '8265708501',
      target_customer_ids: TARGET_CUSTOMER_IDS,
      customer_proofs: [{ customer_id: TARGET_CUSTOMER_IDS[0], identity_match: true }],
      persistence_performed: false,
    });
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
