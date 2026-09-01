'use strict';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeBase64Candidate(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact || compact.length < 16 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8').trim();
    return decoded.startsWith('{') || decoded.startsWith('"') ? decoded : null;
  } catch {
    return null;
  }
}

function serviceAccountObject(value, depth = 0) {
  if (depth > 4) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') return serviceAccountObject(parsed, depth + 1);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Try bounded normalization paths below.
  }

  const unescaped = text
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\"/g, '"');
  if (unescaped !== text) {
    try {
      const parsed = JSON.parse(unescaped);
      if (typeof parsed === 'string') return serviceAccountObject(parsed, depth + 1);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Continue to base64 candidate.
    }
  }

  const decoded = decodeBase64Candidate(text);
  if (decoded) return serviceAccountObject(decoded, depth + 1);
  return null;
}

function normalizeServiceAccount(raw) {
  const account = serviceAccountObject(raw);
  if (!account) throw new Error('GOOGLE_ADS_SERVICE_ACCOUNT is not valid JSON/base64 JSON');

  const clientEmail = String(account.client_email || '').trim();
  let privateKey = String(account.private_key || '').trim();
  if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');

  if (String(account.type || '').trim() !== 'service_account') throw new Error('Service account type is invalid');
  if (!clientEmail || !clientEmail.includes('@')) throw new Error('Service account client_email is missing');
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
    throw new Error('Service account private_key is missing or malformed');
  }
  if (!String(account.token_uri || '').includes('oauth2.googleapis.com/token')) {
    throw new Error('Service account token_uri is missing or unexpected');
  }

  return JSON.stringify({ ...account, client_email: clientEmail, private_key: privateKey });
}

async function syncSecret() {
  const projectRef = required('SUPABASE_PROJECT_REF');
  const accessToken = required('SUPABASE_ACCESS_TOKEN');
  const normalized = normalizeServiceAccount(required('GOOGLE_ADS_SERVICE_ACCOUNT'));

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ name: 'GOOGLE_ADS_SERVICE_ACCOUNT', value: normalized }]),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Supabase service-account sync failed HTTP ${response.status}`);
  }

  const parsed = JSON.parse(normalized);
  console.log(JSON.stringify({
    success: true,
    project_ref: projectRef,
    service_account_project_id: String(parsed.project_id || ''),
    client_email_present: Boolean(parsed.client_email),
    private_key_present: Boolean(parsed.private_key),
  }));
}

if (require.main === module) {
  syncSecret().catch((error) => {
    console.error(`[google-ads-service-account-sync] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = { normalizeServiceAccount, serviceAccountObject };
