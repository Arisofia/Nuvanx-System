#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { normalizeSupabaseBase } = require('./lib/supabase-origin');

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function parseArg(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const args = process.argv.slice(2);
  const direct = args.indexOf(exact);
  if (direct >= 0) return String(args[direct + 1] || '').trim();
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length).trim() : '';
}

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date`);
  }
}

function resolveDateRange(now = new Date()) {
  const requestedTo = parseArg('to') || env('TO_DATE_INPUT');
  const to = requestedTo || now.toISOString().slice(0, 10);
  assertIsoDate(to, 'Meta insights to date');

  // Preserve the workflow's prior semantics exactly: when `from` is omitted,
  // use the first day of the current UTC month even if an explicit `to` date
  // points at a different month.
  const requestedFrom = parseArg('from') || env('FROM_DATE_INPUT');
  const from = requestedFrom || `${now.toISOString().slice(0, 7)}-01`;
  assertIsoDate(from, 'Meta insights from date');
  if (from > to) throw new Error('Meta insights from date must not be after to date');
  return { from, to };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function resolveInternalSecret(base, key, fetchImpl = fetch) {
  const response = await fetchImpl(`${base}/rest/v1/rpc/nvx_get_runtime_secret`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_name: 'REVOPS_INTERNAL_SECRET' }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload !== 'string' || !payload.trim()) {
    throw new Error(`Meta reconciliation internal credential resolution failed (HTTP ${response.status})`);
  }
  return payload.trim();
}

async function fetchMetaDailyInsightsViaEdge({ fetchImpl = fetch, now = new Date() } = {}) {
  const rawBase = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('NUVANX_SUPABASE_SERVICE_ROLE_KEY');
  if (!rawBase || !key) throw new Error('SUPABASE_URL and service-role key are required');

  // Pin the destination to a real Supabase project origin before any
  // credential-bearing request is possible.
  const base = normalizeSupabaseBase(rawBase);
  const range = resolveDateRange(now);
  const internalSecret = await resolveInternalSecret(base, key, fetchImpl);

  const response = await fetchImpl(`${base}/functions/v1/daily-aggregates`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'x-nvx-internal-secret': internalSecret,
    },
    body: JSON.stringify({ action: 'fetch_meta_insights', ...range }),
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await readJson(response);
  if (!response.ok || !payload || payload.success !== true) {
    const kind = String(payload?.kind || '').replace(/\s+/g, ' ').slice(0, 80);
    const message = String(payload?.message || payload?.error || '').replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(
      `Meta daily insights Edge reconciliation failed (HTTP ${response.status}${kind ? `, kind=${kind}` : ''})${message ? `: ${message}` : ''}`,
    );
  }

  const summary = {
    success: true,
    owner: 'supabase_edge/daily-aggregates',
    action: 'fetch_meta_insights',
    auth_mode: 'revops_internal_secret',
    date_range: range,
  };
  console.log(JSON.stringify(summary));
  return { summary, payload };
}

if (require.main === module) {
  fetchMetaDailyInsightsViaEdge().catch((error) => {
    console.error(`[meta-daily-insights-edge] Fatal: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  assertIsoDate,
  fetchMetaDailyInsightsViaEdge,
  normalizeSupabaseBase,
  resolveDateRange,
  resolveInternalSecret,
};
