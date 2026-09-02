'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  encryptCredential,
  recoverGoogleAdsIntegrations,
  validateDeveloperToken,
} = require('./provision-google-ads-developer-token');

function decrypt(encoded, encryptionKey) {
  const [saltHex, ivHex, tagHex, ciphertextHex] = encoded.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const key = crypto.pbkdf2Sync(encryptionKey, salt, 100_000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

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

test('encrypted credential round-trips through the production AES-GCM contract', () => {
  const token = 'developer_token_123';
  const key = 'nuvanx-test-encryption-key';
  const encoded = encryptCredential(token, key);
  assert.match(encoded, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(decrypt(encoded, key), token);
});

test('credential provisioning recovery proves every integration and verifies persisted connected state', async () => {
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
      return jsonResponse({ success: true, integration_id: body.integration_id });
    }

    if (url.includes('/rest/v1/integrations?id=eq.')) {
      const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
      return jsonResponse([{ id, status: 'connected', last_error: null }]);
    }

    throw new Error(`Unexpected test URL: ${url}`);
  };

  const recovered = await recoverGoogleAdsIntegrations({
    base: 'https://example.supabase.co',
    serviceRole: 'service-role-value',
    integrations: [
      { id: 'integration-820', status: 'credential_invalid' },
      { id: 'integration-908', status: 'disconnected' },
    ],
    fetchImpl,
  });

  assert.equal(recovered, 2);
  assert.equal(calls.filter(({ url }) => url.endsWith('/functions/v1/google-ads-health')).length, 2);
  assert.equal(calls.filter(({ url }) => url.includes('/rest/v1/integrations?id=eq.')).length, 2);
});

test('credential recovery fails closed without leaking the internal secret', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rest/v1/rpc/nvx_get_runtime_secret')) {
      return jsonResponse('do-not-log-this-secret');
    }
    if (url.endsWith('/functions/v1/google-ads-health')) {
      return jsonResponse({ success: false, message: 'provider rejected do-not-log-this-secret' }, 424);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };

  await assert.rejects(
    recoverGoogleAdsIntegrations({
      base: 'https://example.supabase.co',
      serviceRole: 'service-role-value',
      integrations: [{ id: 'integration-quarantined', status: 'credential_invalid' }],
      fetchImpl,
    }),
    (error) => {
      assert.match(error.message, /provider recovery failed/);
      assert.doesNotMatch(error.message, /do-not-log-this-secret/);
      return true;
    },
  );
});
