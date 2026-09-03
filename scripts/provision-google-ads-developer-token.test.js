'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CREDENTIAL_FORMAT,
  CREDENTIAL_OWNER,
  acceptGoogleAdsIntegrations,
  credentialContractCurrent,
  provisionGoogleAdsIntegrations,
  requireHttpsBase,
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

test('Supabase base URL must be valid HTTPS before any credential-bearing request', async () => {
  assert.equal(requireHttpsBase('https://example.supabase.co/'), 'https://example.supabase.co');
  assert.throws(() => requireHttpsBase('http://example.supabase.co'), /must use HTTPS/);
  assert.throws(() => requireHttpsBase('not-a-url'), /valid HTTPS URL/);

  let fetchCalled = false;
  await assert.rejects(
    provisionGoogleAdsIntegrations({
      base: 'http://example.supabase.co',
      serviceRole: 'service-role-value',
      developerToken: 'developer-token-value',
      integrations: [{ id: 'integration-820' }],
      fetchImpl: async () => {
        fetchCalled = true;
        return jsonResponse({});
      },
    }),
    /must use HTTPS/,
  );
  assert.equal(fetchCalled, false);
});

test('credential contract is current only when every integration is healthy and every owner is runtime-provisioned', () => {
  const integrations = [
    { user_id: 'owner-1', status: 'connected', last_error: null, last_sync: '2026-09-02T21:00:00Z' },
    { user_id: 'owner-1', status: 'connected', last_error: null, last_sync: '2026-09-02T21:00:01Z' },
  ];
  const credentials = [{
    user_id: 'owner-1',
    metadata: { provisioned_by: CREDENTIAL_OWNER, credential_format: CREDENTIAL_FORMAT },
  }];

  assert.equal(credentialContractCurrent(integrations, credentials), true);
  assert.equal(
    credentialContractCurrent([{ ...integrations[0], last_error: 'provider failure' }, integrations[1]], credentials),
    false,
  );
  assert.equal(
    credentialContractCurrent(integrations, [{
      user_id: 'owner-1',
      metadata: { provisioned_by: 'github_actions', credential_format: CREDENTIAL_FORMAT },
    }]),
    false,
  );
  assert.equal(
    credentialContractCurrent(integrations, [{
      user_id: 'owner-1',
      metadata: { provisioned_by: CREDENTIAL_OWNER, credential_format: 'legacy_format' },
    }]),
    false,
  );
});

test('credential provisioning delegates plaintext token to Edge then round-trips the persisted credential with health', async () => {
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
      assert.match(body.integration_id, /^integration-/);
      assert.equal(options.headers['x-nvx-internal-secret'], 'runtime-secret-value');
      assert.equal(options.headers.apikey, 'service-role-value');
      if (body.operation === 'provision') {
        assert.equal(body.developer_token, 'developer-token-value');
        return jsonResponse({
          success: true,
          operation: 'provision',
          credential_provisioned: true,
          integration_id: body.integration_id,
        });
      }
      assert.equal(body.operation, 'health');
      assert.equal(Object.hasOwn(body, 'developer_token'), false);
      return jsonResponse({
        success: true,
        operation: 'health',
        credential_provisioned: false,
        integration_id: body.integration_id,
      });
    }

    if (url.includes('/rest/v1/integrations?id=eq.')) {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
      return jsonResponse([{ id, status: 'connected', last_error: null, last_sync: '2026-09-02T19:40:00.000Z' }]);
    }

    if (url.includes('/rest/v1/credentials')) {
      throw new Error('Provisioning execution must never write credentials directly');
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
  const runtimeCalls = calls
    .filter(({ url }) => url.endsWith('/functions/v1/google-ads-health'))
    .map(({ options }) => {
      const body = JSON.parse(options.body);
      return [body.integration_id, body.operation];
    });
  assert.deepEqual(runtimeCalls, [
    ['integration-820', 'provision'],
    ['integration-820', 'health'],
    ['integration-908', 'provision'],
    ['integration-908', 'health'],
  ]);
  assert.equal(calls.filter(({ url }) => url.includes('/rest/v1/integrations?id=eq.')).length, 2);
  assert.equal(calls.filter(({ url }) => url.includes('/rest/v1/credentials')).length, 0);
});

test('already-current credentials still require live health acceptance using stored ciphertext', async () => {
  const operations = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return jsonResponse('runtime-secret-value');
    if (url.endsWith('/functions/v1/google-ads-health')) {
      const body = JSON.parse(options.body);
      operations.push(body);
      assert.equal(body.operation, 'health');
      assert.equal(Object.hasOwn(body, 'developer_token'), false);
      return jsonResponse({
        success: true,
        credential_provisioned: false,
        integration_id: body.integration_id,
      });
    }
    if (url.includes('/rest/v1/integrations?id=eq.')) {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
      return jsonResponse([{ id, status: 'connected', last_error: null, last_sync: '2026-09-03T04:00:00.000Z' }]);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };

  const accepted = await acceptGoogleAdsIntegrations({
    base: 'https://example.supabase.co',
    serviceRole: 'service-role-value',
    integrations: [{ id: 'integration-820' }, { id: 'integration-908' }],
    fetchImpl,
  });

  assert.equal(accepted, 2);
  assert.deepEqual(operations.map((body) => body.integration_id), ['integration-820', 'integration-908']);
});

test('post-provision health failure rejects acceptance even after provider proof and commit', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) return jsonResponse('runtime-secret-value');
    if (url.endsWith('/functions/v1/google-ads-health')) {
      const body = JSON.parse(options.body);
      if (body.operation === 'provision') {
        return jsonResponse({ success: true, credential_provisioned: true, integration_id: body.integration_id });
      }
      return jsonResponse({ success: false, kind: 'configuration', message: 'stored credential decrypt failed' }, 500);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };

  await assert.rejects(
    provisionGoogleAdsIntegrations({
      base: 'https://example.supabase.co',
      serviceRole: 'service-role-value',
      developerToken: 'developer-token-value',
      integrations: [{ id: 'integration-820' }],
      fetchImpl,
    }),
    /provisioning failed for 1 integration/,
  );
});

test('credential provisioning continues after one integration fails and reports failures only after all proofs', async () => {
  const runtimeCalls = [];
  const persistedIds = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      return jsonResponse('do-not-log-this-secret');
    }

    if (url.endsWith('/functions/v1/google-ads-health')) {
      const body = JSON.parse(options.body);
      runtimeCalls.push([body.integration_id, body.operation]);
      if (body.integration_id === 'integration-broken' && body.operation === 'provision') {
        return jsonResponse({ success: false, message: 'provider rejected do-not-log-this-secret' }, 424);
      }
      return jsonResponse({
        success: true,
        credential_provisioned: body.operation === 'provision',
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

  assert.deepEqual(runtimeCalls, [
    ['integration-broken', 'provision'],
    ['integration-healthy', 'provision'],
    ['integration-healthy', 'health'],
  ]);
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
