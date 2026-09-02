'use strict';

const crypto = require('node:crypto');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateDeveloperToken(value) {
  const token = String(value || '').trim();
  if (!token || token.length > 512) throw new Error('Google Ads developer token is missing or too long');
  if (token.startsWith('{') || token.includes('private_key') || token.includes('client_email')) {
    throw new Error('Google Ads developer token slot contains a service-account payload');
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) throw new Error('Google Ads developer token contains unsupported characters');
  return token;
}

function encryptCredential(secret, encryptionKey) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(encryptionKey, salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, ciphertext].map((part) => part.toString('hex')).join(':');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function supabaseJson(base, serviceRole, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${base}${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`Supabase request failed HTTP ${response.status}`);
  return payload;
}

async function resolveInternalSecret(base, serviceRole, fetchImpl = fetch) {
  const payload = await supabaseJson(
    base,
    serviceRole,
    '/rest/v1/rpc/nvx_get_runtime_secret',
    {
      method: 'POST',
      body: JSON.stringify({ p_name: 'REVOPS_INTERNAL_SECRET' }),
    },
    fetchImpl,
  );
  const secret = typeof payload === 'string'
    ? payload.trim()
    : String(payload?.nvx_get_runtime_secret || '').trim();
  if (!secret) throw new Error('Google Ads internal recovery secret is unavailable');
  return secret;
}

async function recoverGoogleAdsIntegrations({ base, serviceRole, integrations, fetchImpl = fetch }) {
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new Error('No Google Ads integrations available for recovery');
  }

  const internalSecret = await resolveInternalSecret(base, serviceRole, fetchImpl);
  let recovered = 0;

  for (const integration of integrations) {
    const integrationId = String(integration?.id || '').trim();
    if (!integrationId) throw new Error('Google Ads integration without id');

    const response = await fetchImpl(`${base}/functions/v1/google-ads-health`, {
      method: 'POST',
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        'Content-Type': 'application/json',
        'x-nvx-internal-secret': internalSecret,
      },
      body: JSON.stringify({ integration_id: integrationId }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await readJson(response);
    if (!response.ok || payload?.success !== true) {
      throw new Error(`Google Ads provider recovery failed for integration ${integrationId} (HTTP ${response.status})`);
    }
    if (String(payload?.integration_id || '') !== integrationId) {
      throw new Error(`Google Ads provider recovery returned an integration identity mismatch for ${integrationId}`);
    }

    const persisted = await supabaseJson(
      base,
      serviceRole,
      `/rest/v1/integrations?id=eq.${encodeURIComponent(integrationId)}&select=id,status,last_error`,
      {},
      fetchImpl,
    );
    if (!Array.isArray(persisted) || persisted.length !== 1) {
      throw new Error(`Google Ads recovery persistence verification failed for integration ${integrationId}`);
    }
    const row = persisted[0];
    if (String(row?.id || '') !== integrationId || row?.status !== 'connected' || row?.last_error !== null) {
      throw new Error(`Google Ads integration ${integrationId} did not persist the canonical connected state`);
    }
    recovered += 1;
  }

  return recovered;
}

async function provision() {
  const base = required('SUPABASE_URL').replace(/\/$/, '');
  const serviceRole = required('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = required('ENCRYPTION_KEY');
  const developerToken = validateDeveloperToken(required('GOOGLE_ADS_DEVELOPER_TOKEN'));

  const integrations = await supabaseJson(
    base,
    serviceRole,
    '/rest/v1/integrations?service=eq.google_ads&select=id,user_id,clinic_id,status&order=created_at.asc',
  );
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new Error('No Google Ads integrations found');
  }

  const owners = new Map();
  for (const row of integrations) {
    const userId = String(row?.user_id || '').trim();
    if (!userId) throw new Error('Google Ads integration without user_id');
    if (!owners.has(userId)) owners.set(userId, row?.clinic_id || null);
  }

  const now = new Date().toISOString();
  const rows = [...owners.entries()].map(([userId, clinicId]) => ({
    user_id: userId,
    clinic_id: clinicId,
    service: 'google_ads',
    encrypted_key: encryptCredential(developerToken, encryptionKey),
    metadata: {
      credential_format: 'aes_gcm_pbkdf2_sha256_v1',
      provisioned_at: now,
      provisioned_by: 'github_actions',
    },
  }));

  await supabaseJson(
    base,
    serviceRole,
    '/rest/v1/credentials?on_conflict=user_id,service',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    },
  );

  const integrationsRecovered = await recoverGoogleAdsIntegrations({
    base,
    serviceRole,
    integrations,
  });

  console.log(JSON.stringify({
    success: true,
    owners_provisioned: rows.length,
    integrations_recovered: integrationsRecovered,
    credential_format: 'aes_gcm_pbkdf2_sha256_v1',
  }));
}

if (require.main === module) {
  provision().catch((error) => {
    console.error(`[google-ads-credential-provision] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  encryptCredential,
  recoverGoogleAdsIntegrations,
  resolveInternalSecret,
  validateDeveloperToken,
};
