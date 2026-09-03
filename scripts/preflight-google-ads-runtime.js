'use strict';

const {
  requireHttpsBase,
  resolveInternalSecret,
  validateDeveloperToken,
} = require('./provision-google-ads-developer-token');

const TARGET_CUSTOMER_IDS = ['9084540447', '8201489748'];

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function sorted(values) {
  return [...values].map(String).sort();
}

async function preflightGoogleAdsRuntime({
  base,
  serviceRole,
  developerToken,
  fetchImpl = fetch,
}) {
  const safeBase = requireHttpsBase(base);
  const token = validateDeveloperToken(developerToken);
  const internalSecret = await resolveInternalSecret(safeBase, serviceRole, fetchImpl);

  const response = await fetchImpl(`${safeBase}/functions/v1/google-ads-auth-preflight`, {
    method: 'POST',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      'x-nvx-internal-secret': internalSecret,
    },
    body: JSON.stringify({ developer_token: token }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.success !== true) {
    const kind = String(payload?.kind || 'provider').replace(/[^a-z_]/gi, '').slice(0, 40) || 'provider';
    throw new Error(`Google Ads Edge runtime preflight failed (HTTP ${response.status}, kind=${kind})`);
  }
  if (payload?.persistence_performed !== false) {
    throw new Error('Google Ads Edge runtime preflight did not prove read-only semantics');
  }
  if (!['oauth_refresh', 'service_account'].includes(String(payload?.auth_mode || ''))) {
    throw new Error('Google Ads Edge runtime preflight returned an invalid auth mode');
  }
  if (sorted(payload?.target_customer_ids || []).join(',') !== sorted(TARGET_CUSTOMER_IDS).join(',')) {
    throw new Error('Google Ads Edge runtime preflight target-account contract mismatch');
  }
  const proofs = Array.isArray(payload?.customer_proofs) ? payload.customer_proofs : [];
  const provenIds = proofs
    .filter((proof) => proof?.identity_match === true)
    .map((proof) => String(proof?.customer_id || ''));
  if (sorted(provenIds).join(',') !== sorted(TARGET_CUSTOMER_IDS).join(',')) {
    throw new Error('Google Ads Edge runtime preflight did not prove both customer identities');
  }

  return {
    success: true,
    auth_mode: String(payload.auth_mode),
    login_customer_id: String(payload?.login_customer_id || ''),
    target_customer_ids: TARGET_CUSTOMER_IDS,
    accessible_customer_count: Number(payload?.accessible_customer_count || 0),
    persistence_performed: false,
  };
}

async function main() {
  const result = await preflightGoogleAdsRuntime({
    base: requireHttpsBase(required('SUPABASE_URL')),
    serviceRole: required('SUPABASE_SERVICE_ROLE_KEY'),
    developerToken: validateDeveloperToken(required('GOOGLE_ADS_DEVELOPER_TOKEN')),
  });
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[google-ads-runtime-preflight] ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240)}`);
    process.exit(1);
  });
}

module.exports = {
  TARGET_CUSTOMER_IDS,
  preflightGoogleAdsRuntime,
};
