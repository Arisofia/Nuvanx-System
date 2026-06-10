#!/usr/bin/env node
'use strict';

/**
 * Robust Meta backfill caller for GitHub Actions.
 *
 * The shell-only workflow previously failed without useful diagnostics when curl
 * returned a non-2xx response under `set -e`. This runner captures HTTP status,
 * parses the JSON body, retries transient failures, and fails only after logging
 * actionable context.
 */

const DEFAULT_DAYS = 90;
const MIN_DAYS = 1;
const MAX_DAYS = 90;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function getArgValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];

  return undefined;
}

function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER, label }) {
  const raw = String(value ?? '').trim();
  const normalized = raw || String(fallback);

  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be an integer between ${min} and ${max}. Received: ${raw || '(empty)'}`);
  }

  const parsed = Number.parseInt(normalized, 10);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}. Received: ${parsed}`);
  }

  return parsed;
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} environment variable is required for Meta backfill.`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonBody(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function compactPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  return {
    success: payload.success,
    message: payload.message,
    accountIds: payload.accountIds,
    pageId: payload.pageId,
    igId: payload.igId,
    since: payload.since,
    until: payload.until,
    totalLeadsBackfilled: payload.totalLeadsBackfilled,
    dailyInsightsPersisted: payload.dailyInsightsPersisted,
    organicDailyPersisted: payload.organicDailyPersisted,
    organicPostsPersisted: payload.organicPostsPersisted,
    igAccountDailyPersisted: payload.igAccountDailyPersisted,
    igMediaPersisted: payload.igMediaPersisted,
    errors: Array.isArray(payload.errors) ? payload.errors : undefined,
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : undefined,
  };
}

async function postMetaBackfill({ url, serviceRoleKey, authKey, reportUserId, days, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/functions/v1/api/meta/backfill?days=${days}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authKey}`,
        apikey: serviceRoleKey,
        'x-user-id': reportUserId,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      json: parseJsonBody(body),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetry(result, error, attempt, attempts) {
  if (attempt >= attempts) return false;
  if (error) return true;
  if (!result) return false;
  return RETRYABLE_HTTP_STATUSES.has(result.status);
}

async function main() {
  const days = parsePositiveInteger(getArgValue('--days') ?? process.env.META_BACKFILL_DAYS, DEFAULT_DAYS, {
    min: MIN_DAYS,
    max: MAX_DAYS,
    label: 'days',
  });
  const attempts = parsePositiveInteger(getArgValue('--attempts') ?? process.env.META_BACKFILL_ATTEMPTS, DEFAULT_ATTEMPTS, {
    min: 1,
    max: 5,
    label: 'attempts',
  });
  const timeoutMs = parsePositiveInteger(getArgValue('--timeout-ms') ?? process.env.META_BACKFILL_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, {
    min: 5_000,
    max: 300_000,
    label: 'timeout-ms',
  });

  const url = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const authKey = String(process.env.NUVANX_SUPABASE_SERVICE_ROLE_KEY || '').trim() || serviceRoleKey;
  const reportUserId = requireEnv('REPORT_USER_ID');

  let lastResult = null;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    lastError = null;
    console.log(`→ Running full Meta backfill including Instagram (attempt ${attempt}/${attempts}, days=${days})...`);

    try {
      lastResult = await postMetaBackfill({ url, serviceRoleKey, authKey, reportUserId, days, timeoutMs });
      const summary = compactPayload(lastResult.json) ?? lastResult.body.slice(0, 2000);
      console.log(`Meta backfill HTTP ${lastResult.status} ${lastResult.statusText}`);
      console.log(`Meta backfill response: ${JSON.stringify(summary)}`);

      if (lastResult.ok && lastResult.json?.success === true) {
        console.log('✅ Meta backfill completed successfully.');
        return;
      }
    } catch (error) {
      lastError = error;
      const message = error?.name === 'AbortError'
        ? `Meta backfill timed out after ${timeoutMs}ms.`
        : error?.message || String(error);
      console.error(`Meta backfill request failed: ${message}`);
    }

    if (shouldRetry(lastResult, lastError, attempt, attempts)) {
      const delayMs = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      console.warn(`Retrying Meta backfill in ${delayMs / 1000}s...`);
      await sleep(delayMs);
      continue;
    }

    break;
  }

  const details = lastResult?.json?.message || lastError?.message || lastResult?.body?.slice(0, 1000) || 'Unknown failure';
  throw new Error(`Meta backfill failed after ${attempts} attempt(s): ${details}`);
}

main().catch((error) => {
  console.error(`::error::${error.message || error}`);
  process.exit(1);
});
