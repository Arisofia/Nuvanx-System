#!/usr/bin/env node
'use strict';

require('dotenv').config();

const DEFAULT_LOOKBACK_DAYS = 30;

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

function resolveDateRange() {
  const requestedTo = parseArg('to');
  const to = requestedTo || new Date().toISOString().slice(0, 10);
  assertIsoDate(to, 'Google Ads to date');

  const requestedFrom = parseArg('from');
  let from = requestedFrom;
  if (!from) {
    const start = new Date(`${to}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (DEFAULT_LOOKBACK_DAYS - 1));
    from = start.toISOString().slice(0, 10);
  }
  assertIsoDate(from, 'Google Ads from date');
  if (from > to) throw new Error('Google Ads from date must not be after to date');
  return { from, to };
}

function customerId(value) {
  return String(value || '').replace(/\D/g, '');
}

async function readConnectedCustomers(base, key) {
  const url = new URL(`${base}/rest/v1/integrations`);
  url.searchParams.set('service', 'eq.google_ads');
  url.searchParams.set('status', 'eq.connected');
  url.searchParams.set('select', 'metadata');

  const response = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`Could not read connected Google Ads integrations (HTTP ${response.status})`);
  }

  const ids = new Set(
    payload
      .map((row) => customerId(row?.metadata?.customerId || row?.metadata?.customer_id))
      .filter(Boolean),
  );
  if (ids.size === 0) throw new Error('No connected Google Ads integrations found');
  return ids;
}

async function syncGoogleAdsViaEdge() {
  const base = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('NUVANX_SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('SUPABASE_URL and service-role key are required');

  const range = resolveDateRange();
  const expectedCustomers = await readConnectedCustomers(base, key);
  const response = await fetch(`${base}/functions/v1/google-ads-daily-sync`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(range),
    signal: AbortSignal.timeout(90_000),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success !== true) {
    const failures = Array.isArray(payload?.failures)
      ? payload.failures.map((item) => ({
          customer_id: item?.customer_id || null,
          kind: item?.kind || null,
          message: item?.message || null,
        }))
      : [];
    throw new Error(`Google Ads Edge sync failed (HTTP ${response.status}): ${JSON.stringify(failures)}`);
  }
  if (payload.provider !== 'google_ads' || !Array.isArray(payload.accounts)) {
    throw new Error('Google Ads Edge sync returned an invalid provider contract');
  }

  const returnedCustomers = new Set(payload.accounts.map((row) => customerId(row?.customer_id)).filter(Boolean));
  const missing = [...expectedCustomers].filter((id) => !returnedCustomers.has(id));
  const unexpected = [...returnedCustomers].filter((id) => !expectedCustomers.has(id));
  if (missing.length > 0 || unexpected.length > 0 || returnedCustomers.size !== expectedCustomers.size) {
    throw new Error(`Google Ads account coverage mismatch: missing=${missing.join(',') || 'none'} unexpected=${unexpected.join(',') || 'none'}`);
  }

  const summary = {
    success: true,
    owner: 'supabase_edge/google-ads-daily-sync',
    provider: payload.provider,
    api_version: payload.api_version || null,
    auth_mode: payload.auth_mode || null,
    date_range: payload.date_range || range,
    accounts: payload.accounts,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

if (require.main === module) {
  syncGoogleAdsViaEdge().catch((error) => {
    console.error(`[sync-google-ads-edge] Fatal: ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  customerId,
  resolveDateRange,
  syncGoogleAdsViaEdge,
};
