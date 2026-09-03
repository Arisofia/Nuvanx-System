'use strict';

const crypto = require('node:crypto');
const { normalizeServiceAccount } = require('./sync-google-ads-service-account');

const API_VERSION = 'v25';
const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const LOGIN_CUSTOMER_ID = '8265708501';
const TARGET_CUSTOMERS = ['9084540447', '8201489748'];

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bounded(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, max);
}

function base64Url(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return input.toString('base64url');
}

function refreshConfigState(env = process.env) {
  const keys = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN'];
  const present = keys.filter((key) => String(env[key] || '').trim());
  if (present.length === 0) return 'absent';
  if (present.length !== keys.length) return 'partial';
  return 'complete';
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function providerStatus(payload) {
  return bounded(payload?.error?.status || payload?.error?.code || '', 60) || null;
}

async function mintRefreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const response = await fetchImpl(GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  const accessToken = String(payload?.access_token || '').trim();
  if (!response.ok || !accessToken) {
    const error = new Error(`OAuth refresh token exchange failed HTTP ${response.status}`);
    error.diagnostic = { phase: 'token_exchange', http_status: response.status, provider_status: providerStatus(payload) };
    throw error;
  }
  return accessToken;
}

async function mintServiceAccountAccessToken({ rawServiceAccount, fetchImpl = fetch, now = () => Date.now() }) {
  const account = JSON.parse(normalizeServiceAccount(rawServiceAccount));
  const issuedAt = Math.floor(now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: String(account.client_email),
    scope: GOOGLE_ADS_SCOPE,
    aud: GOOGLE_TOKEN_URI,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), account.private_key);
  const assertion = `${signingInput}.${base64Url(signature)}`;

  const response = await fetchImpl(GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  const accessToken = String(payload?.access_token || '').trim();
  if (!response.ok || !accessToken) {
    const error = new Error(`Service-account token exchange failed HTTP ${response.status}`);
    error.diagnostic = { phase: 'token_exchange', http_status: response.status, provider_status: providerStatus(payload) };
    throw error;
  }
  return accessToken;
}

async function listAccessibleCustomers({ accessToken, developerToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  const resourceNames = Array.isArray(payload?.resourceNames)
    ? payload.resourceNames.map((value) => String(value)).filter((value) => /^customers\/\d+$/.test(value))
    : [];
  return {
    http_status: response.status,
    provider_status: providerStatus(payload),
    accessible_customer_ids: resourceNames.map((value) => value.replace(/\D/g, '')),
  };
}

async function probeCustomerSearch({ accessToken, developerToken, customerId, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'login-customer-id': LOGIN_CUSTOMER_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT customer.id FROM customer LIMIT 1' }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = await readJson(response);
  const returnedId = String(payload?.results?.[0]?.customer?.id || '').replace(/\D/g, '');
  return {
    customer_id: customerId,
    http_status: response.status,
    provider_status: providerStatus(payload),
    identity_match: response.ok && returnedId === customerId,
  };
}

async function probeAuthMode({ mode, accessToken, developerToken, fetchImpl = fetch }) {
  const accessible = await listAccessibleCustomers({ accessToken, developerToken, fetchImpl });
  const customer_probes = [];
  for (const customerId of TARGET_CUSTOMERS) {
    customer_probes.push(await probeCustomerSearch({ accessToken, developerToken, customerId, fetchImpl }));
  }
  const operative = accessible.http_status === 200
    && customer_probes.every((probe) => probe.http_status === 200 && probe.identity_match === true);
  return { mode, operative, list_accessible: accessible, customer_probes };
}

async function runPreflight({ env = process.env, fetchImpl = fetch } = {}) {
  const developerToken = String(env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
  if (!developerToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is required');

  const refreshState = refreshConfigState(env);
  if (refreshState === 'partial') {
    return {
      success: false,
      reason: 'partial_oauth_refresh_configuration',
      refresh_config: refreshState,
      probes: [],
    };
  }

  const candidates = [];
  if (refreshState === 'complete') {
    candidates.push({
      mode: 'oauth_refresh',
      mint: () => mintRefreshAccessToken({
        clientId: String(env.GOOGLE_ADS_CLIENT_ID).trim(),
        clientSecret: String(env.GOOGLE_ADS_CLIENT_SECRET).trim(),
        refreshToken: String(env.GOOGLE_ADS_REFRESH_TOKEN).trim(),
        fetchImpl,
      }),
    });
  }
  if (String(env.GOOGLE_ADS_SERVICE_ACCOUNT || '').trim()) {
    candidates.push({
      mode: 'service_account',
      mint: () => mintServiceAccountAccessToken({
        rawServiceAccount: String(env.GOOGLE_ADS_SERVICE_ACCOUNT),
        fetchImpl,
      }),
    });
  }

  if (candidates.length === 0) {
    return { success: false, reason: 'no_google_ads_oauth_mode_configured', refresh_config: refreshState, probes: [] };
  }

  const probes = [];
  for (const candidate of candidates) {
    try {
      const accessToken = await candidate.mint();
      probes.push(await probeAuthMode({ mode: candidate.mode, accessToken, developerToken, fetchImpl }));
    } catch (error) {
      probes.push({
        mode: candidate.mode,
        operative: false,
        error: error?.diagnostic || { phase: 'local', http_status: null, provider_status: null },
      });
    }
  }

  const operativeModes = probes.filter((probe) => probe.operative).map((probe) => probe.mode);
  const recommended = operativeModes.includes('oauth_refresh')
    ? 'oauth_refresh'
    : operativeModes.includes('service_account')
      ? 'service_account'
      : null;

  return {
    success: Boolean(recommended),
    reason: recommended ? 'provider_read_proof_passed' : 'no_auth_mode_reached_both_customer_accounts',
    refresh_config: refreshState,
    recommended_auth_mode: recommended,
    login_customer_id: LOGIN_CUSTOMER_ID,
    target_customer_ids: TARGET_CUSTOMERS,
    probes,
  };
}

async function main() {
  required('GOOGLE_ADS_DEVELOPER_TOKEN');
  const result = await runPreflight();
  console.log(JSON.stringify(result));
  if (!result.success) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[google-ads-auth-preflight] ${bounded(error?.message || error, 180)}`);
    process.exit(1);
  });
}

module.exports = {
  API_VERSION,
  LOGIN_CUSTOMER_ID,
  TARGET_CUSTOMERS,
  listAccessibleCustomers,
  mintRefreshAccessToken,
  probeAuthMode,
  probeCustomerSearch,
  refreshConfigState,
  runPreflight,
};
