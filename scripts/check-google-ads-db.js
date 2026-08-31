#!/usr/bin/env node
'use strict';

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function check() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required.');
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

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
    if (customerId) {
      const countResult = await supabase
        .from('google_ads_daily_insights')
        .select('*', { count: 'exact', head: true })
        .eq('customer_id', customerId);
      if (countResult.error) throw countResult.error;
      insightCount = countResult.count || 0;

      const latestResult = await supabase
        .from('google_ads_daily_insights')
        .select('date')
        .eq('customer_id', customerId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestResult.error) throw latestResult.error;
      latestInsightDate = latestResult.data?.date || null;
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
      latest_insight_date: latestInsightDate,
      connected: row.status === 'connected' && row.credential_present === true && Boolean(row.customer_id),
    });
  }

  const output = {
    success: true,
    rows: rows.length,
    connected: rows.filter((row) => row.connected).length,
    synced: rows.filter((row) => Boolean(row.last_sync) && row.insight_rows > 0).length,
    data: rows,
  };
  console.log(process.argv.includes('--json') ? JSON.stringify(output) : JSON.stringify(output, null, 2));
  if (rows.length === 0) process.exitCode = 2;
  else if (rows.some((row) => !row.connected)) process.exitCode = 3;
}

check().catch((error) => {
  console.error(`[check-google-ads-db] Failed: ${error.message || error}`);
  process.exit(1);
});
