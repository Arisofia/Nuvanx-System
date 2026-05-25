#!/usr/bin/env node
'use strict';

const crypto = require('crypto');

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const MIN_NODE_MAJOR = 18;

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
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    const code = body?.error?.code ? ` code=${body.error.code}` : '';
    const subcode = body?.error?.error_subcode ? ` subcode=${body.error.error_subcode}` : '';
    const type = body?.error?.type ? ` type=${body.error.type}` : '';
    const message = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Meta API request failed:${code}${subcode}${type} ${message}`.trim());
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

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return message
    .replace(/access_token=[^\s&]+/gi, 'access_token=<redacted>')
    .replace(/appsecret_proof=[^\s&]+/gi, 'appsecret_proof=<redacted>')
    .replace(/EAA[A-Za-z0-9_-]+/g, '<redacted_meta_token>');
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR}+ is required (current: ${process.versions.node}).`);
  }

  const accessToken = String(process.env.META_ACCESS_TOKEN || '').trim();
  const targetAdAccountIds = parseTargetAdAccountIds();

  if (!accessToken) {
    throw new Error('Missing required GitHub secret/env var: META_ACCESS_TOKEN.');
  }

  if (!targetAdAccountIds.length) {
    throw new Error('Missing required GitHub secret/env var: META_AD_ACCOUNT_ID or META_AD_ACCOUNT_IDS.');
  }

  const accounts = await listAccessibleAdAccounts(accessToken);
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

  throw new Error(
    normalized.length
      ? `Token cannot access configured ad account(s): ${missing.join(', ')}.`
      : 'Token cannot access the configured ad account(s). No accessible accounts returned by API.'
  );
}

main().catch((error) => {
  console.error('❌ Meta access verification failed.');
  console.error(`Reason: ${sanitizeError(error)}`);
  process.exit(1);
});
