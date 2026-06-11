#!/usr/bin/env node
'use strict';

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function summarizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return { present: false };
  return {
    present: true,
    keys: Object.keys(metadata).sort(),
  };
}

async function check() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl) throw new Error('SUPABASE_URL or VITE_SUPABASE_URL is required.');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('--- Checking Google Ads credentials ---');
  const { data: credentials, error: credentialsError } = await supabase
    .from('credentials')
    .select('id, service, user_id')
    .eq('service', 'google_ads');

  if (credentialsError) throw credentialsError;
  console.log('Google Ads credentials found:', credentials?.length || 0);

  console.log('\n--- Checking Google Ads integrations ---');
  const { data: integrations, error: integrationsError } = await supabase
    .from('integrations')
    .select('id, service, metadata')
    .eq('service', 'google_ads');

  if (integrationsError) throw integrationsError;
  console.log('Google Ads integrations found:', integrations?.length || 0);

  if (integrations?.length) {
    console.log('First integration metadata summary:', JSON.stringify(summarizeMetadata(integrations[0].metadata), null, 2));
  }
}

check().catch((error) => {
  console.error('[check-google-ads-db] Failed:', error.message || error);
  process.exit(1);
});
