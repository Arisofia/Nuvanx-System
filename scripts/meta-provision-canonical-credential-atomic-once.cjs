'use strict';

const crypto = require('node:crypto');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NUVANX_SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ENCRYPTION_KEY = String(process.env.ENCRYPTION_KEY || '');
const META_TOKEN = String(process.env.META_CANONICAL_ACCESS_TOKEN || '').trim();

const TARGET = Object.freeze({
  userId: 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a',
  clinicId: '4207023b-eac1-4249-bf0f-d9b1e36a5d7a',
  integrationId: 'b3ee75f2-c926-4823-989b-fca551bbaa62',
  appId: '1836302544001572',
  businessId: '897835716596010',
  adAccountId: 'act_718120894191565',
  pageId: '1329458703573874',
  systemUserId: '122098243371455164',
  pixelId: '1037346649192028',
});

for (const [name, value] of Object.entries({ SUPABASE_URL, SERVICE_ROLE, ENCRYPTION_KEY, META_TOKEN })) {
  if (!value) throw new Error(`${name} is required`);
}

const headers = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

function encryptCredential(raw) {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(Buffer.from(ENCRYPTION_KEY, 'utf8'), salt, 100_000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt, iv, tag, ciphertext].map((part) => part.toString('hex')).join(':');
}

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { response, body };
}

function credentialMetadataIsCanonical(metadata = {}) {
  return String(metadata.app_id || '') === TARGET.appId
    && String(metadata.business_id || '') === TARGET.businessId
    && String(metadata.ad_account_id || '') === TARGET.adAccountId
    && Array.isArray(metadata.ad_account_ids)
    && metadata.ad_account_ids.length === 1
    && String(metadata.ad_account_ids[0]) === TARGET.adAccountId
    && String(metadata.page_id || '') === TARGET.pageId
    && String(metadata.system_user_id || '') === TARGET.systemUserId
    && String(metadata.pixel_id || '') === TARGET.pixelId;
}

function integrationMetadataIsCanonical(metadata = {}) {
  return String(metadata.appId || '') === TARGET.appId
    && String(metadata.app_id || '') === TARGET.appId
    && String(metadata.businessPortfolioId || '') === TARGET.businessId
    && String(metadata.business_portfolio_id || '') === TARGET.businessId
    && String(metadata.adAccountId || '') === TARGET.adAccountId
    && String(metadata.ad_account_id || '') === TARGET.adAccountId
    && String(metadata.pageId || '') === TARGET.pageId
    && String(metadata.page_id || '') === TARGET.pageId
    && String(metadata.systemUserId || '') === TARGET.systemUserId
    && String(metadata.system_user_id || '') === TARGET.systemUserId
    && String(metadata.pixelId || '') === TARGET.pixelId
    && String(metadata.pixel_id || '') === TARGET.pixelId
    && metadata.canonical === true
    && metadata.credential_state === 'stored_management_token'
    && metadata.credential_service === 'meta_ads';
}

async function verifyPersistedState() {
  const credentialPath = `credentials?user_id=eq.${encodeURIComponent(TARGET.userId)}&service=eq.meta_ads&select=id,user_id,service,clinic_id,metadata`;
  const integrationPath = `integrations?id=eq.${encodeURIComponent(TARGET.integrationId)}&user_id=eq.${encodeURIComponent(TARGET.userId)}&service=eq.meta_ads&select=id,user_id,service,status,clinic_id,last_error,metadata`;

  const [credentialResult, integrationResult] = await Promise.all([
    request(credentialPath, { method: 'GET' }),
    request(integrationPath, { method: 'GET' }),
  ]);

  if (!credentialResult.response.ok || !integrationResult.response.ok) return false;
  if (!Array.isArray(credentialResult.body) || credentialResult.body.length !== 1) return false;
  if (!Array.isArray(integrationResult.body) || integrationResult.body.length !== 1) return false;

  const credential = credentialResult.body[0];
  const integration = integrationResult.body[0];

  return String(credential.user_id || '') === TARGET.userId
    && credential.service === 'meta_ads'
    && String(credential.clinic_id || '') === TARGET.clinicId
    && credentialMetadataIsCanonical(credential.metadata)
    && String(integration.id || '') === TARGET.integrationId
    && String(integration.user_id || '') === TARGET.userId
    && integration.service === 'meta_ads'
    && integration.status === 'connected'
    && String(integration.clinic_id || '') === TARGET.clinicId
    && integration.last_error === null
    && integrationMetadataIsCanonical(integration.metadata);
}

async function main() {
  if (await verifyPersistedState()) {
    console.log('META_CREDENTIAL_PROVISION=PASS state=already_canonical');
    return;
  }

  const encryptedKey = encryptCredential(META_TOKEN);
  const payload = {
    p_user_id: TARGET.userId,
    p_clinic_id: TARGET.clinicId,
    p_integration_id: TARGET.integrationId,
    p_encrypted_key: encryptedKey,
    p_expected_app_id: TARGET.appId,
    p_expected_business_id: TARGET.businessId,
    p_expected_ad_account_id: TARGET.adAccountId,
    p_expected_page_id: TARGET.pageId,
    p_expected_system_user_id: TARGET.systemUserId,
    p_expected_pixel_id: TARGET.pixelId,
  };

  let rpcResult = null;
  try {
    rpcResult = await request('rpc/provision_meta_ads_credential_once', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn(`META_CREDENTIAL_RPC_RESPONSE=AMBIGUOUS type=${error?.name || 'Error'}`);
  }

  if (rpcResult?.response?.ok) {
    console.log('META_CREDENTIAL_RPC=PASS');
  } else if (rpcResult) {
    console.warn(`META_CREDENTIAL_RPC=NON2XX status=${rpcResult.response.status}`);
  }

  if (!(await verifyPersistedState())) {
    throw new Error('canonical meta_ads credential state was not established');
  }

  console.log('META_CREDENTIAL_PROVISION=PASS state=canonical');
}

main().catch((error) => {
  console.error(`META_CREDENTIAL_PROVISION=FAIL reason=${String(error?.message || error).replace(/[A-Za-z0-9_=-]{32,}/g, '[redacted]')}`);
  process.exit(1);
});
