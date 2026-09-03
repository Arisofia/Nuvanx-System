'use strict';

const { spawnSync } = require('node:child_process');

const OAUTH_KEYS = [
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN',
];
const SERVICE_ACCOUNT_KEY = 'GOOGLE_ADS_SERVICE_ACCOUNT';
const AUTH_MODE_KEY = 'GOOGLE_ADS_AUTH_MODE';
const AUTH_MODES = new Set(['oauth_refresh', 'service_account']);

function clean(value) {
  return String(value ?? '').trim();
}

function resolveIdentity(env = process.env) {
  const oauth = Object.fromEntries(OAUTH_KEYS.map((key) => [key, clean(env[key])]));
  const oauthCount = OAUTH_KEYS.filter((key) => oauth[key]).length;
  const serviceAccount = clean(env[SERVICE_ACCOUNT_KEY]);
  const requestedMode = clean(env[AUTH_MODE_KEY]) || 'service_account';

  if (!AUTH_MODES.has(requestedMode)) {
    throw new Error('Google Ads auth mode is invalid; expected oauth_refresh or service_account.');
  }

  if (requestedMode === 'service_account') {
    if (!serviceAccount) {
      throw new Error('Google Ads service-account mode is selected but the service account is missing.');
    }
    return { mode: 'service_account', oauth, serviceAccount, requestedMode };
  }

  if (oauthCount !== OAUTH_KEYS.length) {
    throw new Error('Google Ads OAuth refresh mode is selected but the complete OAuth tuple is missing.');
  }
  return { mode: 'oauth_refresh', oauth, serviceAccount, requestedMode };
}

function defaultExecSupabase(args, { capture = false } = {}) {
  const result = spawnSync('supabase', args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error('Supabase CLI operation failed');
  }
  return capture ? String(result.stdout || '') : '';
}

function parseSecretNames(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || '[]'));
  } catch {
    throw new Error('Supabase secret inventory returned invalid JSON');
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.secrets)
      ? parsed.secrets
      : null;
  if (!rows) throw new Error('Supabase secret inventory returned an unsupported shape');
  return new Set(rows.map((row) => clean(row?.name)).filter(Boolean));
}

function listSecretNames(projectRef, execSupabase) {
  let output;
  try {
    output = execSupabase(
      ['secrets', 'list', '--project-ref', projectRef, '--output', 'json'],
      { capture: true },
    );
  } catch {
    throw new Error('Unable to inventory Supabase Edge secret names');
  }
  return parseSecretNames(output);
}

function runSecretOperation(label, args, execSupabase) {
  try {
    execSupabase(args, { capture: false });
  } catch {
    throw new Error(`Google Ads Edge auth convergence failed during ${label}`);
  }
}

function expectedSecretShape(identity) {
  return identity.mode === 'oauth_refresh'
    ? { required: new Set([AUTH_MODE_KEY, ...OAUTH_KEYS]), forbidden: new Set() }
    : { required: new Set([AUTH_MODE_KEY, SERVICE_ACCOUNT_KEY]), forbidden: new Set() };
}

function verifySecretShape(names, identity) {
  const { required, forbidden } = expectedSecretShape(identity);
  for (const name of required) {
    if (!names.has(name)) throw new Error('Google Ads Edge auth convergence verification failed');
  }
  for (const name of forbidden) {
    if (names.has(name)) throw new Error('Google Ads Edge auth convergence verification failed');
  }
}

function convergeGoogleAdsEdgeAuth({
  env = process.env,
  execSupabase = defaultExecSupabase,
  validateOnly = false,
} = {}) {
  const identity = resolveIdentity(env);
  if (validateOnly) return { mode: identity.mode, mutated: false };

  const projectRef = clean(env.SUPABASE_PROJECT_REF);
  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error('SUPABASE_PROJECT_REF is invalid');
  }

  if (identity.mode === 'oauth_refresh') {
    runSecretOperation(
      'oauth_refresh_set',
      [
        'secrets',
        'set',
        `${AUTH_MODE_KEY}=oauth_refresh`,
        ...OAUTH_KEYS.map((key) => `${key}=${identity.oauth[key]}`),
        '--project-ref',
        projectRef,
      ],
      execSupabase,
    );
  } else {
    runSecretOperation(
      'service_account_set',
      [
        'secrets',
        'set',
        `${AUTH_MODE_KEY}=service_account`,
        `${SERVICE_ACCOUNT_KEY}=${identity.serviceAccount}`,
        '--project-ref',
        projectRef,
      ],
      execSupabase,
    );
    // Do not remove GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN here.
    // They are project-wide fallbacks also consumed by google-data-manager-export.
    // Google Ads runtime identity selection is isolated by GOOGLE_ADS_AUTH_MODE.
  }

  const after = listSecretNames(projectRef, execSupabase);
  verifySecretShape(after, identity);
  return { mode: identity.mode, mutated: true };
}

function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const result = convergeGoogleAdsEdgeAuth({ validateOnly });
  console.log(`Google Ads Edge auth ${validateOnly ? 'validation' : 'convergence'} mode: ${result.mode}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[google-ads-edge-auth] ${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240)}`);
    process.exit(1);
  }
}

module.exports = {
  AUTH_MODE_KEY,
  AUTH_MODES,
  OAUTH_KEYS,
  SERVICE_ACCOUNT_KEY,
  clean,
  convergeGoogleAdsEdgeAuth,
  parseSecretNames,
  resolveIdentity,
  verifySecretShape,
};
