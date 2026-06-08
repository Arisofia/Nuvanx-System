#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const DEFAULT_META_GRAPH_VERSION = 'v22.0';
const MIN_NODE_MAJOR = 18;
const DEFAULT_VERIFY_CONCURRENCY = 4;

const FAILURE_MESSAGES = {
  INVALID_NODE_VERSION: `Node.js ${MIN_NODE_MAJOR}+ is required.`,
  MISSING_ACCESS_TOKEN: 'Missing required GitHub secret/env var: META_ACCESS_TOKEN.',
  MISSING_AD_ACCOUNT_ID: 'Missing required GitHub secret/env var: META_AD_ACCOUNT_ID, META_AD_ACCOUNT_IDS, or FALLBACK_META_AD_ACCOUNT_ID.',
  META_API_REQUEST_FAILED: 'Meta API request failed. Verify token permissions and Graph API availability.',
  TOKEN_ACCESS_DENIED: 'Token cannot access one or more configured ad accounts.',
  UNKNOWN: 'Unexpected Meta access verification failure.',
};

class MetaApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
    this.cause = options.cause;
  }
}

function getMetaGraphVersion() {
  return String(process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION).trim() || DEFAULT_META_GRAPH_VERSION;
}

function fail(code) {
  console.error('❌ Meta access verification failed.');
  console.error(`Reason: ${maskSensitive(FAILURE_MESSAGES[code] || FAILURE_MESSAGES.UNKNOWN)}`);
  process.exit(1);
}

function maskSensitive(text) {
  if (!text) return text;
  const str = String(text);
  return str
    // Mask passwords in connection strings: postgres://user:password@host
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@\s]+)(@)/gi, '$1****$3')
    // Mask emails: keep first 3 chars, then ***, then @domain
    .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (match, p1, p2) => {
      const maskedP1 = p1.length > 3 ? p1.slice(0, 3) + '***' : '***';
      return maskedP1 + '@' + p2;
    })
    // Mask potential token/secret values in error messages (long alphanumeric strings)
    .replace(/[a-zA-Z0-9_-]{32,}/g, (match) => {
      return match.slice(0, 4) + '****' + match.slice(-4);
    });
}

function normalizeAdAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.startsWith('act_') ? value : `act_${value}`;
}

function parseTargetAdAccountIds(env = process.env) {
  const values = [
    env.META_AD_ACCOUNT_IDS || '',
    env.META_AD_ACCOUNT_ID || '',
    env.FALLBACK_META_AD_ACCOUNT_ID || '',
  ]
    .join(',')
    .split(',')
    .map((item) => normalizeAdAccountId(item))
    .filter(Boolean);

  return Array.from(new Set(values));
}

function buildAppSecretProof(accessToken) {
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  if (!appSecret) return '';

  return crypto
    .createHmac('sha256', appSecret)
    .update(accessToken)
    .digest('hex');
}

function createMetaUrl(path, accessToken) {
  const url = new URL(`https://graph.facebook.com/${getMetaGraphVersion()}${path}`);
  url.searchParams.set('access_token', accessToken);

  const appsecretProof = buildAppSecretProof(accessToken);
  if (appsecretProof) {
    url.searchParams.set('appsecret_proof', appsecretProof);
  }

  return url;
}

function getMetaErrorCode(body) {
  return body?.error?.code ?? body?.error?.error_subcode;
}

function isPermissionError(error) {
  const status = error?.response?.status ?? error?.status;
  const code = String(error?.code ?? getMetaErrorCode(error?.body) ?? '');

  return status === 401 || status === 403 || code === '190' || code === 'TOKEN_ACCESS_DENIED';
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    throw new MetaApiError(FAILURE_MESSAGES.META_API_REQUEST_FAILED, {
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    throw new MetaApiError(FAILURE_MESSAGES.META_API_REQUEST_FAILED, {
      status: res.status,
      code: getMetaErrorCode(body),
      body,
    });
  }

  return body;
}

async function fetchAdAccount(accessToken, accountId) {
  const url = createMetaUrl(`/${accountId}`, accessToken);
  url.searchParams.set('fields', 'id,name,account_status,currency');

  return fetchJson(url);
}

function getVerifyConcurrency() {
  const parsed = Number.parseInt(String(process.env.META_VERIFY_CONCURRENCY || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_VERIFY_CONCURRENCY;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function verifyConfiguredAdAccounts(accessToken, accountIds) {
  return mapWithConcurrency(accountIds, getVerifyConcurrency(), async (accountId) => {
    const account = await fetchAdAccount(accessToken, accountId);
    return {
      id: normalizeAdAccountId(account.id || accountId),
      name: String(account.name || '').trim(),
      status: account.account_status,
      currency: String(account.currency || '').trim(),
    };
  });
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    fail('INVALID_NODE_VERSION');
  }

  const accessToken = String(process.env.META_ACCESS_TOKEN || '').trim();
  const targetAdAccountIds = parseTargetAdAccountIds();

  if (!accessToken) {
    fail('MISSING_ACCESS_TOKEN');
  }

  if (!targetAdAccountIds.length) {
    fail('MISSING_AD_ACCOUNT_ID');
  }

  let verifiedAccounts;
  try {
    verifiedAccounts = await verifyConfiguredAdAccounts(accessToken, targetAdAccountIds);
  } catch (error) {
    if (isPermissionError(error)) {
      fail('TOKEN_ACCESS_DENIED');
    }

    fail('META_API_REQUEST_FAILED');
  }

  console.log(`Verified configured ad accounts: ${verifiedAccounts.length}`);
  console.log(`Configured target ad accounts: ${targetAdAccountIds.length}`);
  console.log('✅ Meta token has access to all configured ad accounts.');
}

if (require.main === module) {
  main().catch(() => {
    fail('UNKNOWN');
  });
}

module.exports = {
  DEFAULT_META_GRAPH_VERSION,
  DEFAULT_VERIFY_CONCURRENCY,
  MetaApiError,
  createMetaUrl,
  getMetaGraphVersion,
  isPermissionError,
  main,
  mapWithConcurrency,
  normalizeAdAccountId,
  parseTargetAdAccountIds,
  verifyConfiguredAdAccounts,
};
