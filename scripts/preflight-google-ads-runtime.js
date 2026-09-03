'use strict';

const {
  requireHttpsBase,
  resolveInternalSecret,
  validateDeveloperToken,
} = require('./provision-google-ads-developer-token');

const CANONICAL_LOGIN_CUSTOMER_ID = '8265708501';
const TARGET_CUSTOMER_IDS = ['9084540447', '8201489748'];
const SAFE_FAILURE_KINDS = new Set(['request', 'configuration', 'oauth', 'provider', 'validation']);
const SAFE_FAILURE_STAGES = new Set(['oauth_token', 'list_accessible_customers', 'gaql_908', 'gaql_820']);

const SAFE_FAILURE_DIAGNOSTICS = [
  ['OAuth refresh configuration is incomplete', 'oauth_refresh_incomplete'],
  ['service account not configured', 'service_account_missing'],
  ['service account is malformed', 'service_account_malformed'],
  ['service-account token_uri is not the canonical Google OAuth endpoint', 'service_account_token_uri_invalid'],
  ['service-account private key unavailable', 'service_account_private_key_missing'],
  ['service-account private key is malformed', 'service_account_private_key_malformed'],
  ['service-account private key import failed', 'service_account_private_key_import_failed'],
  ['service-account assertion signing failed', 'service_account_signing_failed'],
  ['No Google Ads OAuth mode is configured', 'oauth_mode_missing'],
  ['login customer id missing', 'login_customer_id_missing'],
  ['target integrations do not share one login customer id', 'login_customer_id_drift'],
  ['Google Ads login customer id is not the canonical MCC', 'canonical_mcc_invalid'],
  ['Canonical Google Ads MCC is not directly accessible', 'canonical_mcc_not_accessible'],
  ['integration lookup failed', 'integration_lookup_failed'],
  ['Missing connected Google Ads integration', 'target_integration_missing'],
  ['Google Ads API request failed before response', 'provider_transport_failure'],
  ['Google Ads API 401 UNAUTHENTICATED', 'provider_unauthenticated'],
  ['Google Ads API 403 PERMISSION_DENIED', 'provider_permission_denied'],
  ['Google Ads API 400 INVALID_ARGUMENT', 'provider_invalid_argument'],
  ['Google Ads API 404 NOT_FOUND', 'provider_not_found'],
  ['Google Ads API 429 RESOURCE_EXHAUSTED', 'provider_resource_exhausted'],
  ['Google Ads API 500 INTERNAL', 'provider_internal'],
  ['Google Ads API 503 UNAVAILABLE', 'provider_unavailable'],
  ['Google Ads API returned invalid non-JSON payload', 'provider_non_json'],
];

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

function classifyFailureDiagnostic(payload) {
  const candidateKind = String(payload?.kind || '').trim().toLowerCase();
  const kind = SAFE_FAILURE_KINDS.has(candidateKind) ? candidateKind : 'unknown';
  const candidateStage = String(payload?.stage || '').trim().toLowerCase();
  const stage = SAFE_FAILURE_STAGES.has(candidateStage) ? candidateStage : '';
  const message = String(payload?.message || '');
  for (const [needle, code] of SAFE_FAILURE_DIAGNOSTICS) {
    if (message.includes(needle)) {
      return stage ? { kind, stage, diagnostic: code } : { kind, diagnostic: code };
    }
  }
  return stage
    ? { kind, stage, diagnostic: `${kind}_unknown` }
    : { kind, diagnostic: `${kind}_unknown` };
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
    redirect: 'error',
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
    const classified = classifyFailureDiagnostic(payload);
    const stage = classified.stage || 'unknown';
    throw new Error(
      `Google Ads Edge runtime preflight failed (HTTP ${response.status}, kind=${classified.kind}, diagnostic=${classified.diagnostic}, stage=${stage})`,
    );
  }
  if (payload?.persistence_performed !== false) {
    throw new Error('Google Ads Edge runtime preflight did not prove read-only semantics');
  }
  if (!['oauth_refresh', 'service_account'].includes(String(payload?.auth_mode || ''))) {
    throw new Error('Google Ads Edge runtime preflight returned an invalid auth mode');
  }
  if (String(payload?.login_customer_id || '') !== CANONICAL_LOGIN_CUSTOMER_ID) {
    throw new Error('Google Ads Edge runtime preflight canonical MCC mismatch');
  }
  if (payload?.login_customer_accessible !== true) {
    throw new Error('Google Ads Edge runtime preflight did not prove canonical MCC access');
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
    login_customer_id: CANONICAL_LOGIN_CUSTOMER_ID,
    login_customer_accessible: true,
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
  CANONICAL_LOGIN_CUSTOMER_ID,
  TARGET_CUSTOMER_IDS,
  classifyFailureDiagnostic,
  preflightGoogleAdsRuntime,
};
