#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const MIN_NODE_MAJOR = 18;

const FAILURE_MESSAGES = {
  INVALID_NODE_VERSION: `Node.js ${MIN_NODE_MAJOR}+ is required.`,
  MISSING_ACCESS_TOKEN: 'Missing required GitHub secret/env var: META_ACCESS_TOKEN.',
  MISSING_AD_ACCOUNT_ID: 'Missing required GitHub secret/env var: META_AD_ACCOUNT_ID or META_AD_ACCOUNT_IDS.',
  META_API_REQUEST_FAILED: 'Meta API request failed. Verify token permissions and Graph API availability.',
  TOKEN_ACCESS_DENIED: 'Token cannot access one or more configured ad accounts.',
  UNKNOWN: 'Unexpected Meta access verification failure.',
};

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

function parseTargetAdAccountIds() {
  const values = [
    process.env.META_AD_ACCOUNT_IDS || '',
    process.env.META_AD_ACCOUNT_ID || '',
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
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}${path}`);
  url.searchParams.set('access_token', accessToken);

  const appsecretProof = buildAppSecretProof(accessToken);
  if (appsecretProof) {
    url.searchParams.set('appsecret_proof', appsecretProof);
  }

  return url;
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(FAILURE_MESSAGES.META_API_REQUEST_FAILED);
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    throw new Error(FAILURE_MESSAGES.META_API_REQUEST_FAILED);
  }

  return body;
}

async function listAccessibleAdAccounts(accessToken) {
  const url = createMetaUrl('/me/adaccounts', accessToken);
  url.searchParams.set('fields', 'id,name,account_status,currency');
  url.searchParams.set('limit', '500');

  const payload = await fetchJson(url);
  return Array.isArray(payload.data) ? payload.data : [];
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

  let accounts;
  try {
    accounts = await listAccessibleAdAccounts(accessToken);
  } catch {
    fail('META_API_REQUEST_FAILED');
  }
  const normalized = accounts
    .map((row) => ({
      id: normalizeAdAccountId(row.id),
      name: String(row.name || '').trim(),
      status: row.account_status,
      currency: String(row.currency || '').trim(),
    }))
    .filter((row) => row.id);

  const accessibleIds = new Set(normalized.map((account) => account.id));
  const missing = targetAdAccountIds.filter((id) => !accessibleIds.has(id));

  console.log(`Accessible ad accounts: ${normalized.length}`);
  console.log(`Configured target ad accounts: ${targetAdAccountIds.length}`);

  if (!missing.length) {
    console.log('✅ Meta token has access to all configured ad accounts.');
    return;
  }

  fail('TOKEN_ACCESS_DENIED');
}

main().catch(() => {
  fail('UNKNOWN');
});
