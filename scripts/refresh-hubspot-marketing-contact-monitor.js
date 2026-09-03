'use strict';

const SAFE_FAILURE_CODES = new Set([
  'hubspot_credential_unavailable',
  'hubspot_transport_failure',
  'hubspot_unauthorized',
  'hubspot_forbidden',
  'hubspot_rate_limited',
  'hubspot_unavailable',
  'hubspot_provider_failure',
  'hubspot_invalid_response',
  'monitor_state_unavailable',
  'monitor_state_invalid',
  'monitor_persistence_failed',
  'runtime_secret_unavailable',
  'forbidden',
]);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireHttpsBase(raw) {
  const value = String(raw || '').trim().replace(/\/$/, '');
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('SUPABASE_URL must be a hosted HTTPS Supabase URL');
  }
  return url.origin;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function classifyFailure(payload) {
  const candidate = String(payload?.code || '').trim().toLowerCase();
  return SAFE_FAILURE_CODES.has(candidate) ? candidate : 'unknown_failure';
}

async function resolveInternalSecret(base, serviceRole, fetchImpl = fetch) {
  const response = await fetchImpl(`${base}/rest/v1/rpc/nvx_get_runtime_secret`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_name: 'REVOPS_INTERNAL_SECRET' }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload !== 'string' || !payload.trim()) {
    throw new Error('HubSpot monitor internal secret resolution failed');
  }
  return payload.trim();
}

async function refreshHubSpotMarketingContactMonitor({
  base,
  serviceRole,
  fetchImpl = fetch,
}) {
  const safeBase = requireHttpsBase(base);
  const internalSecret = await resolveInternalSecret(safeBase, serviceRole, fetchImpl);

  const response = await fetchImpl(`${safeBase}/functions/v1/hubspot-marketing-contact-monitor`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      'Content-Type': 'application/json',
      'x-nvx-internal-secret': internalSecret,
    },
    body: '{}',
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await readJson(response);
  if (!response.ok || payload?.success !== true) {
    const code = classifyFailure(payload);
    throw new Error(`HubSpot marketing-contact monitor failed (HTTP ${response.status}, code=${code})`);
  }

  const count = Number(payload?.count);
  const threshold = Number(payload?.threshold);
  const aboveThreshold = payload?.above_threshold;
  const thresholdTransition = payload?.threshold_transition;
  const checkedAt = String(payload?.checked_at || '');
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('HubSpot monitor returned invalid count');
  if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error('HubSpot monitor returned invalid threshold');
  if (typeof aboveThreshold !== 'boolean' || typeof thresholdTransition !== 'boolean') {
    throw new Error('HubSpot monitor returned invalid threshold state');
  }
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) throw new Error('HubSpot monitor returned invalid checked_at');

  return {
    success: true,
    count,
    threshold,
    above_threshold: aboveThreshold,
    threshold_transition: thresholdTransition,
    checked_at: checkedAt,
  };
}

async function main() {
  const result = await refreshHubSpotMarketingContactMonitor({
    base: required('SUPABASE_URL'),
    serviceRole: required('SUPABASE_SERVICE_ROLE_KEY'),
  });
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[hubspot-marketing-contact-monitor] ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240)}`);
    process.exit(1);
  });
}

module.exports = {
  SAFE_FAILURE_CODES,
  classifyFailure,
  refreshHubSpotMarketingContactMonitor,
  resolveInternalSecret,
};
