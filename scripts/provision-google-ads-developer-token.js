'use strict';

const CREDENTIAL_OWNER = 'google_ads_health_runtime';
const CREDENTIAL_FORMAT = 'aes_gcm_pbkdf2_sha256_v1';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireHttpsBase(value) {
  const base = String(value || '').trim().replace(/\/$/, '');
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('SUPABASE_URL must use HTTPS');
  return base;
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

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function supabaseJson(base, serviceRole, path, options = {}, fetchImpl = fetch) {
  const safeBase = requireHttpsBase(base);
  const response = await fetchImpl(`${safeBase}${path}`, {
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

function credentialContractCurrent(integrations, credentials) {
  if (!Array.isArray(integrations) || integrations.length === 0) return false;
  if (!Array.isArray(credentials) || credentials.length === 0) return false;

  const healthyIntegrations = integrations.every((row) => (
    String(row?.status || '') === 'connected'
    && row?.last_error === null
    && Boolean(row?.last_sync)
  ));
  if (!healthyIntegrations) return false;

  const currentOwners = new Set(
    credentials
      .filter((row) => (
        row?.metadata?.provisioned_by === CREDENTIAL_OWNER
        && row?.metadata?.credential_format === CREDENTIAL_FORMAT
      ))
      .map((row) => String(row?.user_id || '').trim())
      .filter(Boolean),
  );

  return integrations.every((row) => currentOwners.has(String(row?.user_id || '').trim()));
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

async function invokeGoogleAdsHealth({
  safeBase,
  serviceRole,
  internalSecret,
  integrationId,
  operation,
  developerToken,
  fetchImpl = fetch,
}) {
  const body = { operation, integration_id: integrationId };
  if (operation === 'provision') body.developer_token = validateDeveloperToken(developerToken);

  const response = await fetchImpl(`${safeBase}/functions/v1/google-ads-health`, {
    method: 'POST',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      'x-nvx-internal-secret': internalSecret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.success !== true) {
    throw new Error(`Google Ads provider ${operation} failed for integration ${integrationId} (HTTP ${response.status})`);
  }
  if (String(payload?.integration_id || '') !== integrationId) {
    throw new Error(`Google Ads provider ${operation} returned an integration identity mismatch for ${integrationId}`);
  }
  if (operation === 'provision' && payload?.credential_provisioned !== true) {
    throw new Error(`Google Ads provider provisioning did not persist a credential for integration ${integrationId}`);
  }
  if (operation === 'health' && payload?.credential_provisioned !== false) {
    throw new Error(`Google Ads provider health did not use the persisted credential for integration ${integrationId}`);
  }
  return payload;
}

async function verifyPersistedIntegration(safeBase, serviceRole, integrationId, fetchImpl = fetch) {
  const persisted = await supabaseJson(
    safeBase,
    serviceRole,
    `/rest/v1/integrations?id=eq.${encodeURIComponent(integrationId)}&select=id,status,last_error,last_sync`,
    {},
    fetchImpl,
  );
  if (!Array.isArray(persisted) || persisted.length !== 1) {
    throw new Error(`Google Ads provisioning persistence verification failed for integration ${integrationId}`);
  }
  const row = persisted[0];
  if (String(row?.id || '') !== integrationId || row?.status !== 'connected' || row?.last_error !== null || !row?.last_sync) {
    throw new Error(`Google Ads integration ${integrationId} did not persist the canonical connected state`);
  }
  return row;
}

async function acceptGoogleAdsIntegrations({
  base,
  serviceRole,
  integrations,
  fetchImpl = fetch,
}) {
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new Error('No Google Ads integrations available for runtime acceptance');
  }

  const safeBase = requireHttpsBase(base);
  const internalSecret = await resolveInternalSecret(safeBase, serviceRole, fetchImpl);
  const failures = [];
  let accepted = 0;

  for (let index = 0; index < integrations.length; index += 1) {
    const integrationId = String(integrations[index]?.id || '').trim();
    const failureId = integrationId || `missing-id-${index + 1}`;
    try {
      if (!integrationId) throw new Error('Google Ads integration without id');
      await invokeGoogleAdsHealth({
        safeBase,
        serviceRole,
        internalSecret,
        integrationId,
        operation: 'health',
        fetchImpl,
      });
      await verifyPersistedIntegration(safeBase, serviceRole, integrationId, fetchImpl);
      accepted += 1;
    } catch {
      failures.push(failureId);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Google Ads runtime health acceptance failed for ${failures.length} integration(s): ${failures.join(',')}`);
  }
  return accepted;
}

async function provisionGoogleAdsIntegrations({
  base,
  serviceRole,
  developerToken,
  integrations,
  fetchImpl = fetch,
}) {
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new Error('No Google Ads integrations available for provisioning');
  }

  const safeBase = requireHttpsBase(base);
  const token = validateDeveloperToken(developerToken);
  const internalSecret = await resolveInternalSecret(safeBase, serviceRole, fetchImpl);
  const failures = [];
  let recovered = 0;

  for (let index = 0; index < integrations.length; index += 1) {
    const integrationId = String(integrations[index]?.id || '').trim();
    const failureId = integrationId || `missing-id-${index + 1}`;

    try {
      if (!integrationId) throw new Error('Google Ads integration without id');

      await invokeGoogleAdsHealth({
        safeBase,
        serviceRole,
        internalSecret,
        integrationId,
        operation: 'provision',
        developerToken: token,
        fetchImpl,
      });

      // Mandatory round-trip: the second call no longer receives the plaintext
      // developer token. Edge must read and decrypt the credential it just persisted.
      await invokeGoogleAdsHealth({
        safeBase,
        serviceRole,
        internalSecret,
        integrationId,
        operation: 'health',
        fetchImpl,
      });
      await verifyPersistedIntegration(safeBase, serviceRole, integrationId, fetchImpl);
      recovered += 1;
    } catch {
      failures.push(failureId);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Google Ads provisioning failed for ${failures.length} integration(s): ${failures.join(',')}`);
  }

  return recovered;
}

async function provision() {
  const base = requireHttpsBase(required('SUPABASE_URL'));
  const serviceRole = required('SUPABASE_SERVICE_ROLE_KEY');
  const developerToken = validateDeveloperToken(required('GOOGLE_ADS_DEVELOPER_TOKEN'));

  const integrations = await supabaseJson(
    base,
    serviceRole,
    '/rest/v1/integrations?service=eq.google_ads&select=id,user_id,clinic_id,status,last_error,last_sync&order=created_at.asc',
  );
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new Error('No Google Ads integrations found');
  }

  const owners = new Set();
  for (const row of integrations) {
    const userId = String(row?.user_id || '').trim();
    if (!userId) throw new Error('Google Ads integration without user_id');
    owners.add(userId);
  }

  const credentials = await supabaseJson(
    base,
    serviceRole,
    '/rest/v1/credentials?service=eq.google_ads&select=user_id,metadata',
  );

  if (credentialContractCurrent(integrations, credentials)) {
    const integrationsAccepted = await acceptGoogleAdsIntegrations({
      base,
      serviceRole,
      integrations,
    });
    console.log(JSON.stringify({
      success: true,
      provision_required: false,
      owners_provisioned: 0,
      integrations_recovered: 0,
      integrations_accepted: integrationsAccepted,
      credential_owner: CREDENTIAL_OWNER,
    }));
    return;
  }

  const integrationsRecovered = await provisionGoogleAdsIntegrations({
    base,
    serviceRole,
    developerToken,
    integrations,
  });

  console.log(JSON.stringify({
    success: true,
    provision_required: true,
    owners_provisioned: owners.size,
    integrations_recovered: integrationsRecovered,
    integrations_accepted: integrationsRecovered,
    credential_owner: CREDENTIAL_OWNER,
  }));
}

if (require.main === module) {
  provision().catch((error) => {
    console.error(`[google-ads-credential-provision] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  CREDENTIAL_FORMAT,
  CREDENTIAL_OWNER,
  acceptGoogleAdsIntegrations,
  credentialContractCurrent,
  invokeGoogleAdsHealth,
  provisionGoogleAdsIntegrations,
  requireHttpsBase,
  resolveInternalSecret,
  validateDeveloperToken,
};
