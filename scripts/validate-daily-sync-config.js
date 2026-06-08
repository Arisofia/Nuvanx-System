#!/usr/bin/env node
'use strict';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'DATABASE_URL',
  'META_ACCESS_TOKEN',
  'CLINIC_ID',
  'DOCTORALIA_SHEET_ID',
  'ENCRYPTION_KEY',
];

const RECOMMENDED = [
  'SUPABASE_DB_PASSWORD',
  'META_APP_SECRET',
  'FALLBACK_META_AD_ACCOUNT_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'SHEETS_WEBHOOK_URL_DOCTORALIA',
  'SHEETS_WEBHOOK_SECRET_DOCTORALIA',
  'REPORT_USER_ID',
];

function hasValue(key) {
  return String(process.env[key] || '').trim().length > 0;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

for (const key of REQUIRED) {
  if (!hasValue(key)) fail(`${key} secret is required for Daily Sync Orchestrator.`);
}

if (!hasValue('META_AD_ACCOUNT_ID') && !hasValue('META_AD_ACCOUNT_IDS') && !hasValue('FALLBACK_META_AD_ACCOUNT_ID')) {
  fail('META_AD_ACCOUNT_ID, META_AD_ACCOUNT_IDS, or FALLBACK_META_AD_ACCOUNT_ID secret is required.');
}

if (!hasValue('GOOGLE_DOCTORALIA_SERVICE_ACCOUNT') && !hasValue('GOOGLE_ADS_SERVICE_ACCOUNT')) {
  fail('GOOGLE_DOCTORALIA_SERVICE_ACCOUNT or GOOGLE_ADS_SERVICE_ACCOUNT secret is required for Doctoralia appointments sync.');
}

if (hasValue('SUPABASE_ACCESS_TOKEN') && !/^sbp_[A-Za-z0-9]+$/.test(process.env.SUPABASE_ACCESS_TOKEN)) {
  fail('SUPABASE_ACCESS_TOKEN format is invalid. Expected sbp_ token.');
}

if (hasValue('SUPABASE_PROJECT_REF') && !/^[a-z0-9]{20}$/.test(process.env.SUPABASE_PROJECT_REF)) {
  fail('SUPABASE_PROJECT_REF format is invalid. Expected 20 lowercase alphanumeric characters.');
}

if (process.exitCode) process.exit(process.exitCode);

const missingRecommended = RECOMMENDED.filter((key) => {
  if (key === 'FALLBACK_META_AD_ACCOUNT_ID' && (hasValue('META_AD_ACCOUNT_ID') || hasValue('META_AD_ACCOUNT_IDS'))) {
    return false;
  }

  return !hasValue(key);
});
if (missingRecommended.length > 0) {
  console.warn(`::warning::Recommended Daily Sync secrets not set: ${missingRecommended.join(', ')}`);
}

console.log('Daily Sync required secret validation passed.');
