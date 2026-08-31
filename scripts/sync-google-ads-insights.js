#!/usr/bin/env node
'use strict';

/**
 * Canonical Google Ads daily insights sync.
 *
 * Source of accounts: public.integrations where service=google_ads and status=connected.
 * Source of metrics: Google Ads API v25.
 * Destination: public.google_ads_daily_insights.
 *
 * The sync is idempotent on (user_id, customer_id, campaign_id, date).
 */

const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
require('dotenv').config();

const API_VERSION = 'v25';
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const MAX_RANGE_DAYS = 92;
const DEFAULT_LOOKBACK_DAYS = 30;

function getEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseArg(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const args = process.argv.slice(2);
  const directIndex = args.indexOf(exact);
  if (directIndex >= 0) return String(args[directIndex + 1] || '').trim();
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length).trim() : '';
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function assertIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
}

function resolveDateRange() {
  const requestedTo = parseArg('to') || getEnv('GOOGLE_ADS_TO_DATE') || getEnv('TO_DATE_INPUT');
  const to = requestedTo || isoDate(new Date());
  assertIsoDate(to, 'Google Ads to date');

  const requestedFrom = parseArg('from') || getEnv('GOOGLE_ADS_FROM_DATE') || getEnv('FROM_DATE_INPUT');
  let from = requestedFrom;
  if (!from) {
    const start = new Date(`${to}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (DEFAULT_LOOKBACK_DAYS - 1));
    from = isoDate(start);
  }
  assertIsoDate(from, 'Google Ads from date');

  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  const days = Math.floor((endMs - startMs) / 86_400_000) + 1;
  if (days < 1 || days > MAX_RANGE_DAYS) {
    throw new Error(`Google Ads date range must be between 1 and ${MAX_RANGE_DAYS} days`);
  }
  return { from, to, days };
}

function parseServiceAccount() {
  const raw = getEnv('GOOGLE_ADS_SERVICE_ACCOUNT');
  if (!raw) throw new Error('GOOGLE_ADS_SERVICE_ACCOUNT is required');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_ADS_SERVICE_ACCOUNT must be valid JSON');
  }
  if (!value.client_email || !value.private_key) {
    throw new Error('GOOGLE_ADS_SERVICE_ACCOUNT is missing client_email/private_key');
  }
  return value;
}

async function getGoogleAccessToken(serviceAccount) {
  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/adwords'],
  });
  const token = await auth.authorize();
  if (!token || !token.access_token) throw new Error('Google OAuth did not return an access token');
  return token.access_token;
}

function googleProviderError(status, payload) {
  const error = payload && payload.error ? payload.error : {};
  const providerStatus = String(error.status || '').slice(0, 80);
  const message = String(error.message || '').replace(/\s+/g, ' ').slice(0, 300);
  return new Error(`Google Ads API ${status}${providerStatus ? ` ${providerStatus}` : ''}${message ? `: ${message}` : ''}`);
}

async function googleAdsSearch({ customerId, developerToken, accessToken, loginCustomerId, query }) {
  const rows = [];
  let pageToken = '';
  let pages = 0;
  const seen = new Set();

  do {
    pages += 1;
    if (pages > MAX_PAGES) throw new Error(`Google Ads pagination exceeded ${MAX_PAGES} pages`);
    if (pageToken) {
      if (seen.has(pageToken)) throw new Error('Google Ads returned a repeated page token');
      seen.add(pageToken);
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    const body = { query, pageSize: PAGE_SIZE };
    if (pageToken) body.pageToken = pageToken;

    const response = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw googleProviderError(response.status, payload);
    if (!Array.isArray(payload.results)) throw new Error('Google Ads API returned malformed results');
    rows.push(...payload.results);
    pageToken = String(payload.nextPageToken || '').trim();
  } while (pageToken);

  return rows;
}

function micros(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number / 1_000_000 : 0;
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapGoogleRow(row, integration, syncedAt) {
  const campaign = row.campaign || {};
  const metrics = row.metrics || {};
  const customer = row.customer || {};
  const segments = row.segments || {};
  return {
    user_id: integration.user_id,
    clinic_id: integration.clinic_id || null,
    integration_id: integration.id,
    customer_id: integration.customer_id,
    campaign_id: String(campaign.id || ''),
    campaign_name: String(campaign.name || '(unnamed)'),
    date: String(segments.date || ''),
    campaign_status: campaign.status || null,
    campaign_type: campaign.advertisingChannelType || null,
    impressions: number(metrics.impressions),
    clicks: number(metrics.clicks),
    spend: micros(metrics.costMicros),
    conversions: number(metrics.conversions),
    conversion_value: number(metrics.conversionsValue),
    ctr: number(metrics.ctr),
    average_cpc: micros(metrics.averageCpc),
    cost_per_conversion: micros(metrics.costPerConversion),
    currency_code: customer.currencyCode || null,
    synced_at: syncedAt,
    updated_at: syncedAt,
  };
}

function validateMappedRow(row) {
  if (!row.customer_id || !row.campaign_id || !row.date || !row.user_id || !row.integration_id) {
    throw new Error('Google Ads row is missing a canonical identity field');
  }
}

async function upsertInChunks(supabase, rows, chunkSize = 500) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase
      .from('google_ads_daily_insights')
      .upsert(chunk, { onConflict: 'user_id,customer_id,campaign_id,date' });
    if (error) throw new Error(`Supabase Google Ads upsert failed: ${error.message}`);
  }
}

async function loadIntegrations(supabase) {
  const { data, error } = await supabase
    .from('integrations')
    .select('id,user_id,clinic_id,status,metadata')
    .eq('service', 'google_ads')
    .eq('status', 'connected')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read Google Ads integrations: ${error.message}`);

  const integrations = (data || []).map((row) => ({
    ...row,
    customer_id: digits(row.metadata?.customerId || row.metadata?.customer_id),
    login_customer_id: digits(
      getEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID') ||
      row.metadata?.loginCustomerId ||
      row.metadata?.login_customer_id,
    ),
  }));

  if (integrations.length === 0) throw new Error('No connected Google Ads integrations found');
  for (const integration of integrations) {
    if (!integration.customer_id) throw new Error(`Google Ads integration ${integration.id} has no customer id`);
  }
  const unique = new Set(integrations.map((row) => `${row.user_id}:${row.customer_id}`));
  if (unique.size !== integrations.length) throw new Error('Duplicate Google Ads customer integrations detected');
  return integrations;
}

async function updateIntegrationState(supabase, integrationId, patch) {
  const { error } = await supabase
    .from('integrations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', integrationId);
  if (error) throw new Error(`Could not update Google Ads integration status: ${error.message}`);
}

async function syncGoogleAds() {
  const range = resolveDateRange();
  const supabaseUrl = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const developerToken = getEnv('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!supabaseUrl || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!developerToken) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is required');

  const serviceAccount = parseServiceAccount();
  const accessToken = await getGoogleAccessToken(serviceAccount);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const integrations = await loadIntegrations(supabase);
  const failures = [];
  const summaries = [];

  console.log(`[sync-google-ads] Syncing ${integrations.length} account(s), ${range.from}..${range.to}`);

  for (const integration of integrations) {
    const syncedAt = new Date().toISOString();
    try {
      const query = `
        SELECT
          segments.date,
          customer.currency_code,
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions,
          metrics.conversions_value,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'
        ORDER BY segments.date, campaign.id
      `;

      const providerRows = await googleAdsSearch({
        customerId: integration.customer_id,
        developerToken,
        accessToken,
        loginCustomerId: integration.login_customer_id,
        query,
      });
      const rows = providerRows.map((row) => mapGoogleRow(row, integration, syncedAt));
      rows.forEach(validateMappedRow);
      await upsertInChunks(supabase, rows);
      await updateIntegrationState(supabase, integration.id, {
        last_sync: syncedAt,
        last_error: null,
      });

      const summary = rows.reduce((acc, row) => {
        acc.impressions += row.impressions;
        acc.clicks += row.clicks;
        acc.spend += row.spend;
        acc.conversions += row.conversions;
        return acc;
      }, { customer_id: integration.customer_id, rows: rows.length, impressions: 0, clicks: 0, spend: 0, conversions: 0 });
      summary.spend = Number(summary.spend.toFixed(6));
      summary.conversions = Number(summary.conversions.toFixed(6));
      summaries.push(summary);
      console.log(`[sync-google-ads] ${integration.customer_id}: ${rows.length} rows, spend=${summary.spend}, clicks=${summary.clicks}, conversions=${summary.conversions}`);
    } catch (error) {
      const message = String(error.message || error).replace(/\s+/g, ' ').slice(0, 500);
      failures.push({ customer_id: integration.customer_id, message });
      try {
        await updateIntegrationState(supabase, integration.id, { last_error: message });
      } catch (persistError) {
        console.error(`[sync-google-ads] Could not persist error for ${integration.customer_id}: ${persistError.message}`);
      }
      console.error(`[sync-google-ads] ${integration.customer_id} failed: ${message}`);
    }
  }

  const result = {
    success: failures.length === 0,
    provider: 'google_ads',
    api_version: API_VERSION,
    date_range: range,
    accounts: summaries,
    failures,
  };
  console.log(JSON.stringify(result));
  if (failures.length > 0) throw new Error(`Google Ads sync failed for ${failures.length} account(s)`);
  return result;
}

if (require.main === module) {
  syncGoogleAds().catch((error) => {
    console.error('[sync-google-ads] Fatal:', error.message || error);
    process.exit(1);
  });
}

module.exports = {
  digits,
  micros,
  resolveDateRange,
  mapGoogleRow,
  validateMappedRow,
  syncGoogleAds,
};
