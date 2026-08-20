#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const DEFAULT_META_GRAPH_VERSION = 'v22.0';
const REQUIRED_FIELD = 'leadgen';

class MetaSubscriptionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MetaSubscriptionError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.body = options.body ?? null;
  }
}

function maskSensitive(value) {
  return String(value ?? '')
    .replace(/[A-Za-z0-9_-]{32,}/g, (match) => `${match.slice(0, 4)}****${match.slice(-4)}`);
}

function getGraphVersion(env = process.env) {
  return String(env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION).trim() || DEFAULT_META_GRAPH_VERSION;
}

function buildAppSecretProof(accessToken, appSecret) {
  const token = String(accessToken || '').trim();
  const secret = String(appSecret || '').trim();
  if (!token || !secret) return '';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function addTokenAndProof(url, accessToken, appSecret) {
  const token = String(accessToken || '').trim();
  if (!token) throw new MetaSubscriptionError('Access token is required.');
  url.searchParams.set('access_token', token);
  const proof = buildAppSecretProof(token, appSecret);
  if (proof) url.searchParams.set('appsecret_proof', proof);
  return url;
}

function createSystemUserAccountsUrl({ systemUserAccessToken, systemUserId, appSecret, graphVersion = DEFAULT_META_GRAPH_VERSION }) {
  const normalizedSystemUserId = String(systemUserId || '').trim();
  if (!normalizedSystemUserId) throw new MetaSubscriptionError('META_SYSTEM_USER_ID is required.');
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(normalizedSystemUserId)}/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  return addTokenAndProof(url, systemUserAccessToken, appSecret);
}

function createSubscribedAppsUrl({ pageAccessToken, pageId, appSecret, graphVersion = DEFAULT_META_GRAPH_VERSION }) {
  const normalizedPageId = String(pageId || '').trim();
  if (!normalizedPageId) throw new MetaSubscriptionError('META_PAGE_ID is required.');
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(normalizedPageId)}/subscribed_apps`);
  url.searchParams.set('fields', 'id,name,subscribed_fields');
  return addTokenAndProof(url, pageAccessToken, appSecret);
}

function normalizeSubscribedFields(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((field) => String(field ?? '').trim()).filter(Boolean)));
}

function classifySubscription(payload, expectedAppId = '') {
  const apps = Array.isArray(payload?.data) ? payload.data : [];
  const normalized = apps.map((app) => ({
    id: String(app?.id ?? '').trim(),
    name: String(app?.name ?? '').trim(),
    subscribed_fields: normalizeSubscribedFields(app?.subscribed_fields),
  }));
  const leadgenApps = normalized.filter((app) => app.subscribed_fields.includes(REQUIRED_FIELD));
  const expected = String(expectedAppId || '').trim();
  const expectedApp = expected ? normalized.find((app) => app.id === expected) ?? null : null;
  return {
    apps: normalized,
    leadgenApps,
    leadgenSubscribed: leadgenApps.length > 0,
    expectedAppId: expected || null,
    expectedAppFound: expected ? Boolean(expectedApp) : null,
    expectedAppLeadgenSubscribed: expected ? Boolean(expectedApp?.subscribed_fields.includes(REQUIRED_FIELD)) : null,
  };
}

function selectPageAccessToken(payload, pageId) {
  const normalizedPageId = String(pageId || '').trim();
  const pages = Array.isArray(payload?.data) ? payload.data : [];
  const page = pages.find((item) => String(item?.id ?? '').trim() === normalizedPageId);
  if (!page) {
    throw new MetaSubscriptionError(`System user does not expose Page ${normalizedPageId} in /accounts.`);
  }
  const pageAccessToken = String(page?.access_token || '').trim();
  if (!pageAccessToken) {
    throw new MetaSubscriptionError(`Page ${normalizedPageId} was returned without a Page access token.`);
  }
  return {
    id: normalizedPageId,
    name: String(page?.name ?? '').trim(),
    accessToken: pageAccessToken,
  };
}

async function fetchJson(url, fetchImpl = global.fetch) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const err = body?.error ?? {};
    throw new MetaSubscriptionError(
      String(err?.message || `Meta Graph API ${response.status}`),
      { status: response.status, code: err?.code ?? err?.error_subcode ?? null, body },
    );
  }
  return body;
}

async function inspectLeadgenSubscription({
  systemUserAccessToken,
  systemUserId,
  pageId,
  appSecret = '',
  expectedAppId = '',
  graphVersion,
  fetchImpl = global.fetch,
}) {
  const version = graphVersion || DEFAULT_META_GRAPH_VERSION;
  const accountsUrl = createSystemUserAccountsUrl({
    systemUserAccessToken,
    systemUserId,
    appSecret,
    graphVersion: version,
  });
  const accountsPayload = await fetchJson(accountsUrl, fetchImpl);
  const page = selectPageAccessToken(accountsPayload, pageId);

  const subscribedAppsUrl = createSubscribedAppsUrl({
    pageAccessToken: page.accessToken,
    pageId,
    appSecret,
    graphVersion: version,
  });
  const subscriptionPayload = await fetchJson(subscribedAppsUrl, fetchImpl);
  return {
    page: { id: page.id, name: page.name },
    ...classifySubscription(subscriptionPayload, expectedAppId),
  };
}

async function main() {
  const systemUserAccessToken = String(process.env.META_ACCESS_TOKEN || '').trim();
  const systemUserId = String(process.env.META_SYSTEM_USER_ID || '').trim();
  const pageId = String(process.env.META_PAGE_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const expectedAppId = String(process.env.META_EXPECTED_APP_ID || '').trim();

  if (!systemUserAccessToken) {
    console.error('META_LEADGEN_SUBSCRIPTION_STATUS=UNVERIFIABLE_MISSING_SYSTEM_USER_TOKEN');
    process.exit(2);
  }
  if (!systemUserId) {
    console.error('META_LEADGEN_SUBSCRIPTION_STATUS=UNVERIFIABLE_MISSING_SYSTEM_USER_ID');
    process.exit(2);
  }
  if (!pageId) {
    console.error('META_LEADGEN_SUBSCRIPTION_STATUS=UNVERIFIABLE_MISSING_PAGE_ID');
    process.exit(2);
  }

  try {
    const result = await inspectLeadgenSubscription({
      systemUserAccessToken,
      systemUserId,
      pageId,
      appSecret,
      expectedAppId,
      graphVersion: getGraphVersion(),
    });

    console.log(`META_SYSTEM_USER_ID=${systemUserId}`);
    console.log(`META_PAGE_ID=${result.page.id}`);
    console.log(`META_PAGE_NAME=${JSON.stringify(result.page.name)}`);
    console.log('META_PAGE_ACCESS_TOKEN_RESOLVED=true');
    console.log(`META_SUBSCRIBED_APPS_COUNT=${result.apps.length}`);
    console.log(`META_LEADGEN_APPS_COUNT=${result.leadgenApps.length}`);
    for (const app of result.apps) {
      console.log(`META_SUBSCRIBED_APP id=${app.id || 'unknown'} name=${JSON.stringify(app.name)} fields=${app.subscribed_fields.join(',') || 'none'}`);
    }

    if (result.expectedAppId) {
      console.log(`META_EXPECTED_APP_FOUND=${result.expectedAppFound}`);
      console.log(`META_EXPECTED_APP_LEADGEN=${result.expectedAppLeadgenSubscribed}`);
    }

    if (!result.leadgenSubscribed) {
      console.error('META_LEADGEN_SUBSCRIPTION_STATUS=MISSING_LEADGEN');
      process.exit(3);
    }
    if (result.expectedAppId && !result.expectedAppLeadgenSubscribed) {
      console.error('META_LEADGEN_SUBSCRIPTION_STATUS=LEADGEN_ON_DIFFERENT_APP');
      process.exit(4);
    }

    console.log('META_LEADGEN_SUBSCRIPTION_STATUS=OK');
  } catch (error) {
    const status = error?.status ?? 'unknown';
    const code = error?.code ?? 'unknown';
    console.error(`META_LEADGEN_SUBSCRIPTION_STATUS=UNVERIFIABLE_GRAPH_ERROR status=${status} code=${code}`);
    console.error(`META_LEADGEN_SUBSCRIPTION_ERROR=${maskSensitive(error?.message || error)}`);
    process.exit(5);
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_META_GRAPH_VERSION,
  REQUIRED_FIELD,
  MetaSubscriptionError,
  addTokenAndProof,
  buildAppSecretProof,
  classifySubscription,
  createSubscribedAppsUrl,
  createSystemUserAccountsUrl,
  fetchJson,
  getGraphVersion,
  inspectLeadgenSubscription,
  normalizeSubscribedFields,
  selectPageAccessToken,
};
