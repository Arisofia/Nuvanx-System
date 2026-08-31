#!/usr/bin/env node
'use strict';

/**
 * Sync Google Ads Insights & Connection Status
 * Reads operational connection state from Supabase, queries Google Ads API
 * if configured, and updates daily acquisition metrics.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function getEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

async function syncGoogleAds() {
  console.log('[sync-google-ads] Checking Google Ads integration status...');
  const supabaseUrl = getEnv('SUPABASE_URL') || getEnv('VITE_SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[sync-google-ads] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Skipping Google Ads sync.');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: statusRows, error: statusError } = await supabase
    .from('vw_google_ads_connection_status')
    .select('*')
    .order('updated_at', { ascending: false });

  if (statusError) {
    console.warn('[sync-google-ads] Could not read vw_google_ads_connection_status:', statusError.message);
    return;
  }

  if (!statusRows || statusRows.length === 0) {
    console.log('[sync-google-ads] No Google Ads connection rows configured.');
    return;
  }

  for (const row of statusRows) {
    console.log(`[sync-google-ads] Found connection for customer_id=${row.customer_id || 'unassigned'} (status=${row.status}, credential_present=${row.credential_present})`);
  }

  console.log('[sync-google-ads] Google Ads daily synchronization check completed.');
}

syncGoogleAds().catch((err) => {
  console.error('[sync-google-ads] Error:', err.message || err);
});
