#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || 'v22.0').trim() || 'v22.0';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ENCRYPTION_KEY = String(process.env.ENCRYPTION_KEY || '').trim();
const META_APP_SECRET = String(process.env.META_APP_SECRET || '').trim();

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validateId(name, value, pattern) {
  if (!pattern.test(value)) throw new Error(`${name} has invalid format`);
  return value;
}

function normalizeAccountId(value) {
  const raw = String(value || '').trim();
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

async function supabaseGet(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Supabase REST ${response.status}`);
  return await response.json();
}

function decryptCredential(encoded) {
  const parts = String(encoded || '').split(':');
  if (parts.length !== 4) throw new Error('Malformed encrypted Meta credential');
  const [saltHex, ivHex, tagHex, ciphertextHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const key = crypto.pbkdf2Sync(ENCRYPTION_KEY, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function appSecretProof(accessToken) {
  if (!META_APP_SECRET) return '';
  return crypto.createHmac('sha256', META_APP_SECRET).update(accessToken).digest('hex');
}

async function graphGet(path, params, accessToken) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}${path}`);
  url.searchParams.set('access_token', accessToken);
  const proof = appSecretProof(accessToken);
  if (proof) url.searchParams.set('appsecret_proof', proof);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const err = body.error || {};
    throw new Error(`Meta API ${response.status} code=${err.code || '?'} sub=${err.error_subcode || '?'}: ${err.message || 'request failed'}`);
  }
  return body;
}

async function graphGetWithFallback(path, fieldSets, accessToken) {
  let lastError;
  for (const fields of fieldSets) {
    try {
      return await graphGet(path, { fields }, accessToken);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function permissionMap(payload) {
  const result = {};
  for (const row of Array.isArray(payload?.data) ? payload.data : []) {
    if (row && typeof row.permission === 'string') result[row.permission] = row.status || 'unknown';
  }
  return result;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY || !ENCRYPTION_KEY) {
    throw new Error('Supabase service configuration or ENCRYPTION_KEY missing');
  }

  const accountId = normalizeAccountId(required('TARGET_AD_ACCOUNT_ID'));
  validateId('TARGET_AD_ACCOUNT_ID', accountId, /^act_\d+$/);
  const campaignId = validateId('TARGET_CAMPAIGN_ID', required('TARGET_CAMPAIGN_ID'), /^\d+$/);
  const adsetId = validateId('TARGET_ADSET_ID', required('TARGET_ADSET_ID'), /^\d+$/);
  const adId = validateId('TARGET_AD_ID', required('TARGET_AD_ID'), /^\d+$/);

  const integrations = await supabaseGet(
    'integrations?service=eq.meta&status=eq.connected&select=user_id,metadata,updated_at&order=updated_at.desc&limit=1',
  );
  const integration = integrations?.[0];
  if (!integration?.user_id) throw new Error('Connected Meta integration not found');

  const metadata = integration.metadata || {};
  const configuredAccounts = [
    ...(Array.isArray(metadata.adAccountIds) ? metadata.adAccountIds : []),
    ...(Array.isArray(metadata.ad_account_ids) ? metadata.ad_account_ids : []),
    metadata.adAccountId,
    metadata.ad_account_id,
  ].filter(Boolean).map(normalizeAccountId);
  if (!new Set(configuredAccounts).has(accountId)) {
    throw new Error('Target ad account is not allowlisted by the connected Meta integration');
  }

  const creds = await supabaseGet(
    `credentials?user_id=eq.${encodeURIComponent(integration.user_id)}&service=eq.meta&select=encrypted_key&limit=1`,
  );
  const encrypted = creds?.[0]?.encrypted_key;
  if (!encrypted) throw new Error('Encrypted Meta credential not found');
  const accessToken = decryptCredential(encrypted);

  const permissionsPayload = await graphGet('/me/permissions', {}, accessToken);
  const permissions = permissionMap(permissionsPayload);

  const campaign = await graphGetWithFallback(
    `/${campaignId}`,
    [
      'id,name,status,effective_status,objective,buying_type,special_ad_categories,daily_budget,lifetime_budget,bid_strategy,account_id',
      'id,name,status,effective_status,objective,buying_type,special_ad_categories,account_id',
      'id,name,status,effective_status,account_id',
    ],
    accessToken,
  );
  if (normalizeAccountId(campaign.account_id) !== accountId) throw new Error('Campaign does not belong to target ad account');

  const adset = await graphGetWithFallback(
    `/${adsetId}`,
    [
      'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,bid_amount,targeting,promoted_object,attribution_spec,start_time,end_time',
      'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_strategy,targeting,promoted_object,attribution_spec,start_time,end_time',
      'id,name,status,effective_status,campaign_id',
    ],
    accessToken,
  );
  if (String(adset.campaign_id) !== campaignId) throw new Error('Ad set does not belong to target campaign');

  const ad = await graphGetWithFallback(
    `/${adId}`,
    [
      'id,name,status,effective_status,campaign_id,adset_id,creative{id,name},tracking_specs,conversion_specs',
      'id,name,status,effective_status,campaign_id,adset_id,creative{id,name}',
      'id,name,status,effective_status,campaign_id,adset_id',
    ],
    accessToken,
  );
  if (String(ad.campaign_id) !== campaignId || String(ad.adset_id) !== adsetId) {
    throw new Error('Ad does not belong to target campaign/ad set');
  }

  const output = {
    verified_account: accountId,
    permissions: {
      ads_read: permissions.ads_read || 'not_granted',
      ads_management: permissions.ads_management || 'not_granted',
      business_management: permissions.business_management || 'not_granted',
    },
    campaign,
    adset,
    ad,
  };

  console.log('META_ADS_INSPECT=PASS');
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error('META_ADS_INSPECT=FAIL');
  console.error(String(error?.message || error));
  process.exit(1);
});
