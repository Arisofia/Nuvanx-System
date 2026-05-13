#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');

const META_GRAPH = 'https://graph.facebook.com/v22.0';
const REQUEST_TIMEOUT_MS = Number(process.env.META_VERIFY_TIMEOUT_MS || 30_000);
const MAX_ATTEMPTS = Number(process.env.META_VERIFY_ATTEMPTS || 3);

function normalizeAdAccountId(raw) {
  const value = String(raw || '').trim();
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replaceAll(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

function appsecretProof(token, appSecret) {
  if (!token || !appSecret) return '';
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskForLog(value) {
  const s = String(value || '');
  if (!s) return 'unknown';
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

function getMetaError(data, status) {
  const err = data?.error || {};
  const code = err.code || 'unknown';
  const subcode = err.error_subcode || 'unknown';
  const message = err.message || `Meta API ${status}`;
  const traceId = err.fbtrace_id || 'unknown';
  return `[Meta Error] status=${status} code=${code} subcode=${subcode} trace_id=${traceId} message=${message}`;
}

function isTransient(status, data) {
  const message = String(data?.error?.message || '').toLowerCase();
  const code = Number(data?.error?.code || 0);
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
    || [4, 17, 613, 800].includes(code)
    || message.includes('throttl')
    || message.includes('rate limit');
}

function redactAdAccountIdForLog(adAccountId) {
  const normalized = String(adAccountId || '');
  const digits = normalized.replace(/^act_/i, '');
  if (!digits) return 'act_[redacted]';
  const suffix = digits.slice(-4);
  return `act_***${suffix}`;
}

async function fetchAccount({ adAccountId, token, appSecret, attempt = 1 }) {
  const url = new URL(`${META_GRAPH}/${adAccountId}`);
  url.searchParams.set('fields', 'account_id,name,account_status,currency');

  const proof = appsecretProof(token, appSecret);
  if (proof) url.searchParams.set('appsecret_proof', proof);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        console.warn(
          '[verify-meta-access] Received non-JSON response body from Meta; falling back to raw text.',
          error,
        );
        data = { rawBody: text };
      }
    } else {
      data = {};
    }

    if (!response.ok) {
      if (attempt < MAX_ATTEMPTS && isTransient(response.status, data)) {
        const backoffMs = 750 * 2 ** (attempt - 1);
        console.warn(
          `[verify-meta-access] Transient Meta response ${response.status}; retrying in ${backoffMs}ms.`,
        );
        await sleep(backoffMs);
        return fetchAccount({ adAccountId, token, appSecret, attempt: attempt + 1 });
      }
      throw new Error(getMetaError(data, response.status));
    }

    return data;
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    const retryable = message.includes('aborted')
      || message.includes('timeout')
      || message.includes('fetch failed');
    if (attempt < MAX_ATTEMPTS && retryable) {
      const backoffMs = 750 * 2 ** (attempt - 1);
      console.warn(
        `[verify-meta-access] Meta verification request failed; retrying in ${backoffMs}ms.`,
      );
      await sleep(backoffMs);
      return fetchAccount({ adAccountId, token, appSecret, attempt: attempt + 1 });
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const adAccountId = normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID);

  const missing = [];
  if (!token) missing.push('META_ACCESS_TOKEN');
  if (!appSecret) missing.push('META_APP_SECRET');
  if (!adAccountId) missing.push('META_AD_ACCOUNT_ID');

  if (missing.length > 0) {
    throw new Error(`Missing or invalid required environment variables: ${missing.join(', ')}`);
  }

  console.log(
    `[verify-meta-access] Checking Meta access to ${redactAdAccountIdForLog(adAccountId)} with appsecret_proof enabled...`,
  );
  const account = await fetchAccount({ adAccountId, token, appSecret });
  console.log(
    `[verify-meta-access] Meta access OK: ${maskForLog(account.name || 'Unnamed account')} (${maskForLog(account.account_id || adAccountId)})`,
  );
}

main().catch((err) => {
  console.error(`::error::[verify-meta-access] ${err.message}`);
  process.exit(1);
});
