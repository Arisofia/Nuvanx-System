#!/usr/bin/env node
/**
 * Execute Doctoralia lead matching by normalized phone.
 *
 * Usage:
 *   node scripts/match-doctoralia-phone.js
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function createSupabaseAdminClient() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL');
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function runMatching() {
  console.log('Starting Doctoralia lead matching by normalized phone...');

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc('match_leads_to_doctoralia_by_phone');

  if (error) {
    throw new Error(`Doctoralia phone matching failed: ${error.message}`);
  }

  const updatedCount = Number(data ?? 0);
  console.log(`Doctoralia phone matching completed. Leads updated: ${updatedCount}`);
  console.log('Conversion attribution has been refreshed in the database.');
}

runMatching().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
