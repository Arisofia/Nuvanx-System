#!/usr/bin/env node
'use strict';

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function validateDate(name, value) {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be in YYYY-MM-DD format.`);
  }
  return value;
}

async function check() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required.');
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const from = validateDate('--from', parseArg('--from'));
  const to = validateDate('--to', parseArg('--to'));
  if (from && to && from > to) {
    throw new Error('--from must not be after --to.');
  }
  const hasRange = Boolean(from || to);

  let query = supabase
    .from('vw_google_ads_connection_status')
    .select('integration_id,user_id,clinic_id,status,customer_id,credential_present,credential_created_at,credential_last_used,last_sync,last_error,updated_at')
    .order('updated_at', { ascending: false });
  const userId = String(process.env.GOOGLE_ADS_STATUS_USER_ID || '').trim();
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw error;

  const connections = data || [];
  const rows = [];
  for (const row of connections) {
    const customerId = String(row.customer_id || '').replace(/\D/g, '');
    let insightCount = 0;
    let latestInsightDate = null;
    let rangeRows = 0;
    if (customerId) {
      const countResult = await supabase
        .from('google_ads_daily_insights')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', row.user_id)
        .eq('customer_id', customerId);
      if (countResult.error) throw countResult.error;
      insightCount = countResult.count || 0;

      const latestResult = await supabase
        .from('google_ads_daily_insights')
        .select('date')
        .eq('user_id', row.user_id)
        .eq('customer_id', customerId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestResult.error) throw latestResult.error;
      latestInsightDate = latestResult.data?.date || null;

      if (hasRange) {
        let rangeQuery = supabase
          .from('google_ads_daily_insights')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', row.user_id)
          .eq('customer_id', customerId);
        if (from) rangeQuery = rangeQuery.gte('date', from);
        if (to) rangeQuery = rangeQuery.lte('date', to);
        const rangeResult = await rangeQuery;
        if (rangeResult.error) throw rangeResult.error;
        rangeRows = rangeResult.count || 0;
      }
    }

    rows.push({
      integration_id: row.integration_id,
      user_id: row.user_id,
      clinic_id: row.clinic_id,
      status: row.status,
      customer_id: row.customer_id,
      credential_present: row.credential_present === true,
      credential_created_at: row.credential_created_at,
      credential_last_used: row.credential_last_used,
      last_sync: row.last_sync,
      last_error_present: Boolean(row.last_error),
      updated_at: row.updated_at,
      insight_rows: insightCount,
      range_rows: hasRange ? rangeRows : undefined,
      latest_insight_date: latestInsightDate,
      connected: row.status === 'connected' && row.credential_present === true && Boolean(customerId),
    });
  }

  const connectedRows = rows.filter((row) => row.connected);
  const output = {
    success: true,
    rows: rows.length,
    connected: connectedRows.length,
    synced: rows.filter((row) => Boolean(row.last_sync) && row.insight_rows > 0).length,
    range: hasRange ? { from, to } : undefined,
    range_synced: hasRange ? connectedRows.filter((row) => row.range_rows > 0).length : undefined,
    data: rows,
  };
  console.log(process.argv.includes('--json') ? JSON.stringify(output) : JSON.stringify(output, null, 2));

  if (rows.length === 0) {
    process.exitCode = 2;
  } else if (rows.some((row) => !row.connected)) {
    process.exitCode = 3;
  } else if (hasRange && connectedRows.some((row) => row.range_rows === 0)) {
    // A date range was requested but a connected customer has no rows in it.
    process.exitCode = 4;
  }
}

check().catch((error) => {
  console.error(`[check-google-ads-db] Failed: ${error.message || error}`);
  process.exit(1);
});
