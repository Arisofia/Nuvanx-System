'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  provisionGoogleAdsIntegrations,
  validateDeveloperToken,
} = require('./provision-google-ads-developer-token');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return payload === null || payload === undefined ? '' : JSON.stringify(payload);
    },
  };
}

test('developer token validation rejects service-account payloads', () => {
  assert.throws(() => validateDeveloperToken('{"client_email":"x","private_key":"y"}'), /service-account payload/);
  assert.equal(validateDeveloperToken('abc_DEF-123.xyz~'), 'abc_DEF-123.xyz~');
});

test('credential provisioning delegates plaintext token to authenticated Edge runtime and never writes credentials directly', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { p_name: 'REVOPS_INTERNAL_SECRET' });
      return jsonResponse('runtime-secret-value');
    }

    if (url.endsWith('/functions/v1/google-ads-health')) {
      const body = JSON.parse(options.body);
      assert.equal(body.operation, 'provision');
      assert.match(body.integration_id, /^integration-/);
      assert.equal(body.developer_token, 'developer-token-value');
      assert.equal(options.headers['x-nvx-internal-secret'], 'runtime-secret-value');
      assert.equal(options.headers.apikey, 'service-role-value');
      return jsonResponse({
        success: true,
        credential_provisioned: true,
        integration_id: body.integration_id,
      });
    }

    if (url.includes('/rest/v1/integrations?id=eq.')) {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
      return jsonResponse([{ id, status: 'connected', last_error: null, last_sync: '2026-09-02T19:40:00.000Z' }]);
    }

    if (url.includes('/rest/v1/credentials')) {
      throw new Error('Provisioning script must never write credentials directly');
    }

    throw new Error(`Unexpected test URL: ${url}`);
  };

  const recovered = await provisionGoogleAdsIntegrations({
    base: 'https://example.supabase.co',
    serviceRole: 'service-role-value',
    developerToken: 'developer-token-value',
    integrations: [
      { id: 'integration-820', status: 'credential_invalid' },
      { id: 'integration-908', status: 'disconnected' },
    ],
    fetchImpl,
  });

  assert.equal(recovered, 2);
  assert.equal(calls.filter(({ url }) => url.endsWith('/functions/v1/google-ads-health')).length, 2);
  assert.equal(calls.filter(({ url }) => url.includes('/rest/v1/integrations?id=eq.')).length, 2);
  assert.equal(calls.filter(({ url }) => url.includes('/rest/v1/credentials')).length, 0);
});

test('credential provisioning continues after one integration fails and reports failures only after all proofs', async () => {
  const healthIds = [];
  const persistedIds = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      return jsonResponse('do-not-log-this-secret');
    }

    if (url.endsWith('/functions/v1/google-ads-health')) {
      const body = JSON.parse(options.body);
      healthIds.push(body.integration_id);
      assert.equal(body.operation, 'provision');
      assert.equal(body.developer_token, 'developer-token-value');
      if (body.integration_id === 'integration-broken') {
        return jsonResponse({ success: false, message: 'provider rejected do-not-log-this-secret' }, 424);
      }
      return jsonResponse({
        success: true,
        credential_provisioned: true,
        integration_id: body.integration_id,
      });
    }

    if (url.includes('/rest/v1/integrations?id=eq.')) {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
      persistedIds.push(id);
      return jsonResponse([{ id, status: 'connected', last_error: null, last_sync: '2026-09-02T19:40:00.000Z' }]);
    }

    throw new Error(`Unexpected test URL: ${url}`);
  };

  await assert.rejects(
    provisionGoogleAdsIntegrations({
      base: 'https://example.supabase.co',
      serviceRole: 'service-role-value',
      developerToken: 'developer-token-value',
      integrations: [
        { id: 'integration-broken', status: 'credential_invalid' },
        { id: 'integration-healthy', status: 'disconnected' },
      ],
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /provisioning failed for 1 integration/);
      assert.match(error.message, /integration-broken/);
      assert.doesNotMatch(error.message, /do-not-log-this-secret/);
      assert.doesNotMatch(error.message, /developer-token-value/);
      return true;
    },
  );

  assert.deepEqual(healthIds, ['integration-broken', 'integration-healthy']);
  assert.deepEqual(persistedIds, ['integration-healthy']);
});

test('credential provisioning fails closed without leaking internal or provider secrets', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      return jsonResponse('do-not-log-this-secret');
    }
    if (url.endsWith('/functions/v1/google-ads-health')) {
      return jsonResponse({ success: false, message: 'provider rejected developer-token-value do-not-log-this-secret' }, 424);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };

  await assert.rejects(
    provisionGoogleAdsIntegrations({
      base: 'https://example.supabase.co',
      serviceRole: 'service-role-value',
      developerToken: 'developer-token-value',
      integrations: [{ id: 'integration-quarantined', status: 'credential_invalid' }],
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /provisioning failed for 1 integration/);
      assert.match(error.message, /integration-quarantined/);
      assert.doesNotMatch(error.message, /do-not-log-this-secret/);
      assert.doesNotMatch(error.message, /developer-token-value/);
      return true;
    },
  );
});
