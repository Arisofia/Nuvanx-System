#!/usr/bin/env node
'use strict';

const CANONICAL_DOCTORALIA_SHEET_ID = '1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NUVANX_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'DATABASE_URL',
  'META_ACCESS_TOKEN',
  'CLINIC_ID',
  'DOCTORALIA_SHEET_ID',
  'ENCRYPTION_KEY',
  'REPORT_USER_ID',
];

const RECOMMENDED = [
  'SUPABASE_DB_PASSWORD',
  'META_APP_SECRET',
  'FALLBACK_META_AD_ACCOUNT_ID',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CUSTOMER_ID',
  'SHEETS_WEBHOOK_URL_DOCTORALIA',
  'SHEETS_WEBHOOK_SECRET_DOCTORALIA',
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


function validateCanonicalDoctoraliaSheet() {
  const appointmentsSheetId = String(process.env.DOCTORALIA_APPOINTMENTS_SHEET_ID || '').trim();
  const legacySheetId = String(process.env.DOCTORALIA_SHEET_ID || '').trim();
  if (appointmentsSheetId && appointmentsSheetId !== CANONICAL_DOCTORALIA_SHEET_ID) {
    fail(`DOCTORALIA_APPOINTMENTS_SHEET_ID must point to canonical Doctoralia sheet ${CANONICAL_DOCTORALIA_SHEET_ID}; received ${appointmentsSheetId}.`);
  }

  if (!appointmentsSheetId && legacySheetId && legacySheetId !== CANONICAL_DOCTORALIA_SHEET_ID) {
    fail(`DOCTORALIA_SHEET_ID fallback must point to canonical Doctoralia sheet ${CANONICAL_DOCTORALIA_SHEET_ID}; received ${legacySheetId}.`);
  }

  if (hasValue('DOCTORALIA_APPOINTMENTS_MIN_ROWS')) {
    const minRows = Number.parseInt(process.env.DOCTORALIA_APPOINTMENTS_MIN_ROWS, 10);
    if (!Number.isFinite(minRows) || minRows < 1800) {
      fail('DOCTORALIA_APPOINTMENTS_MIN_ROWS must be at least 1800 for complete Doctoralia daily sync loads.');
    }
  }
}

validateCanonicalDoctoraliaSheet();

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
