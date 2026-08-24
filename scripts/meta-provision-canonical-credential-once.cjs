'use strict';

const crypto = require('node:crypto');

const E = process.env;
const token = String(E.META_CANONICAL_ACCESS_TOKEN || '').trim();
const encryptionKey = String(E.ENCRYPTION_KEY || '');
const supabaseUrl = String(E.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceRole = String(E.SUPABASE_SERVICE_ROLE_KEY || E.NUVANX_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const userId = E.TARGET_USER_ID;
const clinicId = E.TARGET_CLINIC_ID;
const integrationId = E.TARGET_INTEGRATION_ID;

function requireValue(name, value) {
  if (!String(value || '').trim()) throw new Error(`${name} is required`);
}

for (const [name, value] of Object.entries({ token, encryptionKey, supabaseUrl, serviceRole, userId, clinicId, integrationId })) {
  requireValue(name, value);
}

const headers = {
  apikey: serviceRole,
  Authorization: `Bearer ${serviceRole}`,
  'Content-Type': 'application/json',
};

async function rest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) throw new Error(`Supabase REST ${response.status} ${response.statusText}`);
  return body;
}

function encryptCredential(raw) {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(encryptionKey, 'utf8'), salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, ciphertext].map((buf) => buf.toString('hex')).join(':');
}

function assertCanonicalIntegration(row) {
  const m = row.metadata || {};
  const checks = [
    ['app', m.appId, m.app_id, E.CANONICAL_APP_ID],
    ['business', m.businessPortfolioId, m.business_portfolio_id, E.CANONICAL_BUSINESS_ID],
    ['ad_account', m.adAccountId, m.ad_account_id, E.CANONICAL_AD_ACCOUNT_ID],
    ['page', m.pageId, m.page_id, E.CANONICAL_PAGE_ID],
    ['system_user', m.systemUserId, m.system_user_id, E.CANONICAL_SYSTEM_USER_ID],
  ];
  for (const [label, camel, snake, expected] of checks) {
    if (String(camel || '') !== String(expected) || String(snake || '') !== String(expected)) {
      throw new Error(`Canonical integration ${label} mismatch`);
    }
  }
  if (String(row.clinic_id || '') !== String(clinicId)) throw new Error('Canonical integration clinic mismatch');
  if (row.status !== 'disconnected') throw new Error(`Expected disconnected integration; got ${row.status}`);
  if (String(m.credential_state || '') !== 'missing_management_token') {
    throw new Error(`Expected missing_management_token; got ${m.credential_state || 'unset'}`);
  }
}

async function main() {
  const credentialFilter = `credentials?user_id=eq.${encodeURIComponent(userId)}&service=eq.meta_ads&select=id,user_id,service,clinic_id,metadata,created_at`;
  const existing = await rest(credentialFilter, { method: 'GET' });
  if (!Array.isArray(existing)) throw new Error('Unexpected credentials query response');
  if (existing.length !== 0) {
    throw new Error(`Refusing overwrite: meta_ads credential already exists (count=${existing.length})`);
  }

  const integrationPath = `integrations?id=eq.${encodeURIComponent(integrationId)}&user_id=eq.${encodeURIComponent(userId)}&service=eq.meta_ads`;
  const rows = await rest(`${integrationPath}&select=id,user_id,service,status,clinic_id,last_error,metadata,updated_at`, { method: 'GET' });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`Expected one canonical integration row; got ${Array.isArray(rows) ? rows.length : 'invalid'}`);
  const original = rows[0];
  assertCanonicalIntegration(original);

  const encryptedKey = encryptCredential(token);
  let credentialInserted = false;
  let integrationPatched = false;

  try {
    await rest('credentials', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        service: 'meta_ads',
        encrypted_key: encryptedKey,
        clinic_id: clinicId,
        metadata: {
          clinic_id: clinicId,
          app_id: E.CANONICAL_APP_ID,
          business_id: E.CANONICAL_BUSINESS_ID,
          ad_account_id: E.CANONICAL_AD_ACCOUNT_ID,
          ad_account_ids: [E.CANONICAL_AD_ACCOUNT_ID],
          page_id: E.CANONICAL_PAGE_ID,
          system_user_id: E.CANONICAL_SYSTEM_USER_ID,
          pixel_id: E.CANONICAL_PIXEL_ID,
          source: 'canonical_system_user_provision_2026-08-24',
        },
      }),
    });
    credentialInserted = true;

    const nextMetadata = {
      ...(original.metadata || {}),
      canonical: true,
      credential_state: 'stored_management_token',
      credential_service: 'meta_ads',
      pixelId: E.CANONICAL_PIXEL_ID,
      pixel_id: E.CANONICAL_PIXEL_ID,
      source: 'canonical_system_user_provision_2026-08-24',
      provisioned_at: new Date().toISOString(),
    };
    await rest(integrationPath, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'connected', last_error: null, metadata: nextMetadata, updated_at: new Date().toISOString() }),
    });
    integrationPatched = true;

    const credentialAfter = await rest(credentialFilter, { method: 'GET' });
    const integrationAfter = await rest(`${integrationPath}&select=id,status,clinic_id,last_error,metadata`, { method: 'GET' });
    if (!Array.isArray(credentialAfter) || credentialAfter.length !== 1) throw new Error('Credential post-check failed');
    if (!Array.isArray(integrationAfter) || integrationAfter.length !== 1) throw new Error('Integration post-check failed');
    const after = integrationAfter[0];
    const m = after.metadata || {};
    if (after.status !== 'connected') throw new Error('Integration status post-check failed');
    if (m.credential_state !== 'stored_management_token') throw new Error('Credential state post-check failed');
    if (String(m.systemUserId || '') !== E.CANONICAL_SYSTEM_USER_ID) throw new Error('System User post-check failed');
    if (String(m.pixelId || '') !== E.CANONICAL_PIXEL_ID) throw new Error('Pixel post-check failed');

    console.log(`META_CREDENTIAL_PROVISION=PASS service=meta_ads user=${userId} integration=${integrationId} account=${E.CANONICAL_AD_ACCOUNT_ID} system_user=${E.CANONICAL_SYSTEM_USER_ID} pixel=${E.CANONICAL_PIXEL_ID}`);
  } catch (error) {
    if (integrationPatched) {
      try {
        await rest(integrationPath, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            status: original.status,
            last_error: original.last_error,
            metadata: original.metadata,
            updated_at: original.updated_at,
          }),
        });
        console.error('META_CREDENTIAL_INTEGRATION_ROLLBACK=PASS');
      } catch {
        console.error('META_CREDENTIAL_INTEGRATION_ROLLBACK=FAIL manual_cleanup_required=true');
      }
    }
    if (credentialInserted) {
      try {
        await rest(`credentials?user_id=eq.${encodeURIComponent(userId)}&service=eq.meta_ads`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
        console.error('META_CREDENTIAL_ROW_ROLLBACK=PASS');
      } catch {
        console.error('META_CREDENTIAL_ROW_ROLLBACK=FAIL manual_cleanup_required=true');
      }
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`META_CREDENTIAL_PROVISION=FAIL reason=${error.message || String(error)}`);
  process.exit(1);
});
