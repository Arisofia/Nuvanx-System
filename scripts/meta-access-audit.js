#!/usr/bin/env node

import fs from 'node:fs';

const config = JSON.parse(fs.readFileSync(new URL('../config/meta/rsv26-canonical.json', import.meta.url), 'utf8'));

const candidates = [
  ['META_ADS_MANAGEMENT_TOKEN', process.env.META_ADS_MANAGEMENT_TOKEN],
  ['META_CANONICAL_ACCESS_TOKEN', process.env.META_CANONICAL_ACCESS_TOKEN],
  ['META_REPORTING_TOKEN_60D', process.env.META_REPORTING_TOKEN_60D],
];
const requiredSource = String(process.env.META_ACCESS_AUDIT_REQUIRED_SOURCE || '').trim();
const requireCritical = String(process.env.META_ACCESS_AUDIT_REQUIRE_CRITICAL || '').trim().toLowerCase() === 'true';
const requireAll = String(process.env.META_ACCESS_AUDIT_REQUIRE_ALL || '').trim().toLowerCase() === 'true';
const requireAppMatch = String(process.env.META_ACCESS_AUDIT_REQUIRE_APP_MATCH || '').trim().toLowerCase() === 'true';
const requireCriticalAssets = String(process.env.META_ACCESS_AUDIT_REQUIRE_CRITICAL_ASSETS || '').trim().toLowerCase() === 'true';

let selected;
if (requiredSource) {
  selected = candidates.find(([name, value]) => name === requiredSource && typeof value === 'string' && value.trim());
  if (!selected) {
    console.error(`META_ACCESS_AUDIT=FAIL reason=required_token_missing source=${requiredSource}`);
    process.exit(1);
  }
} else {
  selected = candidates.find(([, value]) => typeof value === 'string' && value.trim());
}

if (!selected) {
  console.error('META_ACCESS_AUDIT=FAIL reason=no_token');
  process.exit(1);
}

const [tokenSource, rawToken] = selected;
const token = rawToken.trim();
const appSecret = String(process.env.META_CANONICAL_APP_SECRET || '').trim();
const graphVersion = String(config.graph_version || 'v22.0');
const expectedPermissions = [
  'instagram_shopping_tag_products',
  'email',
  'ads_management',
  'ads_read',
  'business_management',
  'manage_app_solution',
  'pages_manage_ads',
  'pages_manage_engagement',
  'pages_manage_metadata',
  'pages_manage_posts',
  'pages_messaging',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_show_list',
  'pages_utility_messaging',
  'ads_mcp_management',
  'catalog_management',
  'facebook_branded_content_ads_brand',
  'instagram_basic',
  'instagram_branded_content_ads_brand',
  'instagram_branded_content_brand',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_contents',
  'instagram_manage_insights',
  'instagram_manage_messages',
  'leads_retrieval',
  'manage_fundraisers',
  'paid_marketing_messages',
  'publish_video',
  'read_insights',
  'threads_business_basic',
  'whatsapp_business_manage_events',
  'whatsapp_business_management',
  'whatsapp_business_messaging',
].sort();

function buildGraphUrl(path, params = {}, accessToken = token) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${String(path).replace(/^\//, '')}`);
  url.searchParams.set('access_token', accessToken);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

async function graphGetWithToken(path, params = {}, accessToken = token) {
  const response = await fetch(buildGraphUrl(path, params, accessToken), {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function graphGet(path, params = {}) {
  return graphGetWithToken(path, params, token);
}

function safeError(body) {
  return body?.error
    ? {
        code: body.error.code ?? null,
        subcode: body.error.error_subcode ?? null,
        type: body.error.type ?? null,
        message: body.error.message ?? null,
      }
    : null;
}

function summarizeRows(body) {
  return Array.isArray(body?.data) ? body.data.length : null;
}

function normalizeAdAccountId(value) {
  return String(value ?? '').trim().replace(/^act_/, '');
}

async function debugCanonicalToken() {
  if (!appSecret) {
    return { status: null, ok: false, skipped: true, reason: 'app_secret_missing' };
  }
  const appId = String(config.app_id);
  const url = new URL(`https://graph.facebook.com/${graphVersion}/debug_token`);
  url.searchParams.set('input_token', token);
  url.searchParams.set('access_token', `${appId}|${appSecret}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  const data = body?.data ?? {};
  return {
    status: response.status,
    ok: response.ok && data?.is_valid === true,
    skipped: false,
    is_valid: data?.is_valid === true,
    app_id_match: data?.app_id ? String(data.app_id) === appId : false,
    system_user_match: data?.user_id && config.preferred_system_user_id
      ? String(data.user_id) === String(config.preferred_system_user_id)
      : null,
    token_type: data?.type ?? null,
    expires_at: Number(data?.expires_at ?? 0) || null,
    data_access_expires_at: Number(data?.data_access_expires_at ?? 0) || null,
    error: safeError(body),
  };
}

async function resolvePageAccessToken(pageId) {
  const direct = await graphGet(pageId, { fields: 'id,name,access_token' });
  if (direct.response.ok && direct.body?.access_token) {
    return {
      token: String(direct.body.access_token),
      source: 'page_object',
      page_id_match: String(direct.body?.id ?? '') === String(pageId),
      error: null,
    };
  }

  const accounts = await graphGet('me/accounts', { fields: 'id,name,access_token', limit: 100 });
  const row = Array.isArray(accounts.body?.data)
    ? accounts.body.data.find((item) => String(item?.id ?? '') === String(pageId) && item?.access_token)
    : null;
  if (accounts.response.ok && row?.access_token) {
    return {
      token: String(row.access_token),
      source: 'me_accounts',
      page_id_match: true,
      error: null,
    };
  }

  return {
    token: null,
    source: null,
    page_id_match: false,
    error: safeError(direct.body) ?? safeError(accounts.body) ?? { message: 'page_access_token_not_returned' },
  };
}

console.log(`META_ACCESS_AUDIT_TOKEN_SOURCE=${tokenSource}`);
console.log(`META_ACCESS_AUDIT_GRAPH_VERSION=${graphVersion}`);
console.log(`META_ACCESS_AUDIT_REQUIRED_SOURCE=${requiredSource || 'none'}`);
console.log(`META_ACCESS_AUDIT_REQUIRE_CRITICAL=${requireCritical}`);
console.log(`META_ACCESS_AUDIT_REQUIRE_ALL=${requireAll}`);
console.log(`META_ACCESS_AUDIT_REQUIRE_APP_MATCH=${requireAppMatch}`);
console.log(`META_ACCESS_AUDIT_REQUIRE_CRITICAL_ASSETS=${requireCriticalAssets}`);

const tokenDebug = await debugCanonicalToken();
console.log(`META_TOKEN_DEBUG=${JSON.stringify(tokenDebug)}`);

const permissionProbe = await graphGet('me/permissions');
const permissionRows = Array.isArray(permissionProbe.body?.data) ? permissionProbe.body.data : [];
const permissionMap = new Map(permissionRows.map((row) => [String(row.permission), String(row.status)]));
const granted = [...permissionMap.entries()].filter(([, status]) => status === 'granted').map(([permission]) => permission).sort();
const declined = [...permissionMap.entries()].filter(([, status]) => status !== 'granted').map(([permission, status]) => `${permission}:${status}`).sort();
const missing = expectedPermissions.filter((permission) => permissionMap.get(permission) !== 'granted');
const unexpectedGranted = granted.filter((permission) => !expectedPermissions.includes(permission));

console.log(`META_PERMISSIONS_HTTP=${permissionProbe.response.status}`);
console.log(`META_PERMISSIONS_EXPECTED_COUNT=${expectedPermissions.length}`);
console.log(`META_PERMISSIONS_GRANTED_COUNT=${granted.length}`);
console.log(`META_PERMISSIONS_GRANTED=${JSON.stringify(granted)}`);
console.log(`META_PERMISSIONS_MISSING=${JSON.stringify(missing)}`);
console.log(`META_PERMISSIONS_NON_GRANTED=${JSON.stringify(declined)}`);
console.log(`META_PERMISSIONS_EXTRA_GRANTED=${JSON.stringify(unexpectedGranted)}`);

const criticalPermissions = ['ads_read', 'ads_management', 'business_management', 'pages_show_list', 'pages_read_engagement', 'leads_retrieval', 'instagram_basic'];
const criticalMissing = criticalPermissions.filter((permission) => permissionMap.get(permission) !== 'granted');
console.log(`META_CRITICAL_PERMISSIONS=${criticalMissing.length === 0 ? 'PASS' : 'FAIL'} missing=${JSON.stringify(criticalMissing)}`);

const ids = {
  business: String(config.business_id),
  adAccount: String(config.ad_account_id),
  campaign: String(config.campaign.id),
  page: String(config.defaults.page_id),
  instagram: String(config.defaults.instagram_user_id),
  leadForm: String(config.defaults.lead_gen_form_id),
};

const criticalAssetFailures = [];
const probes = [
  ['ad_account', ids.adAccount, { fields: 'id,name,account_status,disable_reason,business' }, 'object'],
  ['campaign', ids.campaign, { fields: 'id,name,status,effective_status,objective' }, 'object'],
  ['business', ids.business, { fields: 'id,name' }, 'object'],
  ['business_owned_ad_accounts', `${ids.business}/owned_ad_accounts`, { fields: 'id,name,account_status', limit: 100 }, 'rows'],
  ['business_owned_pages', `${ids.business}/owned_pages`, { fields: 'id,name', limit: 100 }, 'rows'],
  ['business_owned_pixels', `${ids.business}/owned_pixels`, { fields: 'id,name,last_fired_time', limit: 100 }, 'rows'],
  ['business_owned_catalogs', `${ids.business}/owned_product_catalogs`, { fields: 'id,name', limit: 100 }, 'rows'],
  ['business_owned_wabas', `${ids.business}/owned_whatsapp_business_accounts`, { fields: 'id,name', limit: 100 }, 'rows'],
  ['page', ids.page, { fields: 'id,name,instagram_business_account' }, 'object'],
  ['lead_form_leads', `${ids.leadForm}/leads`, { fields: 'id', limit: 1 }, 'rows'],
  ['instagram_business', ids.instagram, { fields: 'id,username,followers_count,media_count' }, 'object'],
];

const criticalProbeLabels = new Set([
  'ad_account',
  'campaign',
  'business',
  'business_owned_ad_accounts',
  'business_owned_pages',
  'business_owned_pixels',
  'business_owned_wabas',
  'page',
  'lead_form_leads',
  'instagram_business',
]);

for (const [label, path, params, mode] of probes) {
  try {
    const { response, body } = await graphGet(path, params);
    const result = {
      status: response.status,
      ok: response.ok,
      rows: mode === 'rows' ? summarizeRows(body) : undefined,
      id_match: mode === 'object' && body?.id ? String(body.id) === String(path) : undefined,
      error: safeError(body),
    };
    if (label === 'ad_account' && body?.id) {
      result.id_match = normalizeAdAccountId(body.id) === normalizeAdAccountId(ids.adAccount);
    }
    if (label === 'campaign' && body?.id) result.id_match = String(body.id) === ids.campaign;
    if (label === 'business' && body?.id) result.id_match = String(body.id) === ids.business;
    if (label === 'page' && body?.id) {
      result.id_match = String(body.id) === ids.page;
      result.instagram_business_account_id = body?.instagram_business_account?.id ? String(body.instagram_business_account.id) : null;
      result.instagram_business_account_match = result.instagram_business_account_id === ids.instagram;
    }
    if (label === 'instagram_business' && body?.id) result.id_match = String(body.id) === ids.instagram;
    console.log(`META_ASSET_PROBE ${label}=${JSON.stringify(result)}`);

    if (criticalProbeLabels.has(label)) {
      const objectMismatch = mode === 'object' && result.id_match !== true;
      const pageInstagramMismatch = label === 'page' && result.instagram_business_account_match !== true;
      const requiredRowsMissing = ['business_owned_ad_accounts', 'business_owned_pages', 'business_owned_pixels', 'business_owned_wabas'].includes(label)
        && !(Number(result.rows) > 0);
      if (!response.ok || objectMismatch || pageInstagramMismatch || requiredRowsMissing) criticalAssetFailures.push(label);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`META_ASSET_PROBE ${label}=${JSON.stringify({ status: null, ok: false, error: { message } })}`);
    if (criticalProbeLabels.has(label)) criticalAssetFailures.push(label);
  }
}

const pageToken = await resolvePageAccessToken(ids.page);
console.log(`META_PAGE_ACCESS_TOKEN=${JSON.stringify({ available: Boolean(pageToken.token), source: pageToken.source, page_id_match: pageToken.page_id_match, error: pageToken.error })}`);
if (pageToken.token) {
  const { response, body } = await graphGetWithToken(`${ids.page}/leadgen_forms`, { fields: 'id,name,status', limit: 100 }, pageToken.token);
  const forms = Array.isArray(body?.data) ? body.data : [];
  const targetFormPresent = forms.some((form) => String(form?.id ?? '') === ids.leadForm);
  const result = {
    status: response.status,
    ok: response.ok,
    rows: forms.length,
    target_form_present: targetFormPresent,
    error: safeError(body),
  };
  console.log(`META_PAGE_LEADGEN_FORMS=${JSON.stringify(result)}`);
  if (!response.ok || !targetFormPresent) criticalAssetFailures.push('page_leadgen_forms');
} else {
  console.log(`META_PAGE_LEADGEN_FORMS=${JSON.stringify({ status: null, ok: false, rows: null, target_form_present: false, error: pageToken.error })}`);
  criticalAssetFailures.push('page_leadgen_forms');
}

const selectionMatch = missing.length === 0;
console.log(`META_PERMISSION_SELECTION_MATCH=${selectionMatch ? 'PASS' : 'PARTIAL'} expected=${expectedPermissions.length} missing=${missing.length}`);
console.log(`META_CRITICAL_ASSETS=${criticalAssetFailures.length === 0 ? 'PASS' : 'FAIL'} failures=${JSON.stringify([...new Set(criticalAssetFailures)])}`);

let exitCode = permissionProbe.response.status === 200 ? 0 : 1;
if (requireCritical && criticalMissing.length > 0) exitCode = 1;
if (requireAll && !selectionMatch) exitCode = 1;
if (requireAppMatch && (!tokenDebug.ok || tokenDebug.app_id_match !== true)) exitCode = 1;
if (requireCriticalAssets && criticalAssetFailures.length > 0) exitCode = 1;

if (exitCode !== 0) {
  console.error(`META_ACCESS_AUDIT=FAIL source=${tokenSource} http=${permissionProbe.response.status} critical_missing=${criticalMissing.length} all_missing=${missing.length} asset_failures=${criticalAssetFailures.length} app_match=${tokenDebug.app_id_match === true}`);
} else {
  console.log(`META_ACCESS_AUDIT=PASS source=${tokenSource}`);
}
process.exitCode = exitCode;
