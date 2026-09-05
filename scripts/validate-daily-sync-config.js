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
  'DOCTORALIA_DRIVE_FILE_ID',
  'ENCRYPTION_KEY',
  'REPORT_USER_ID',
];

const RECOMMENDED = [
  'SUPABASE_DB_PASSWORD',
  'META_APP_SECRET',
  'FALLBACK_META_AD_ACCOUNT_ID',
  'SHEETS_WEBHOOK_URL_DOCTORALIA',
  'SHEETS_WEBHOOK_SECRET_DOCTORALIA',
];

function hasValue(key) {
  return String(process.env[key] || '').trim().length > 0;
}

function readServiceAccountEmail(rawCredential) {
  const raw = String(rawCredential || '').trim();
  if (!raw) return '';
  try {
    const credentials = JSON.parse(raw);
    const email = typeof credentials.client_email === 'string' ? credentials.client_email.trim() : '';
    const key = typeof credentials.private_key === 'string' ? credentials.private_key.trim() : '';
    return email && key ? email : '';
  } catch {
    return '';
  }
}

const ERROR_MESSAGES = {
  DOCTORALIA_APPOINTMENTS_SHEET_MISMATCH: 'DOCTORALIA_APPOINTMENTS_SHEET_ID must match DOCTORALIA_SHEET_ID. Values are redacted.',
  DOCTORALIA_DRIVE_FILE_MISMATCH: 'DOCTORALIA_DRIVE_FILE_ID must match DOCTORALIA_SHEET_ID for the Google Sheets sync. Values are redacted.',
  DOCTORALIA_PERMISSION_MODE_INVALID: 'DOCTORALIA_SYNC_PERMISSION_MODE and DOCTORALIA_APPOINTMENTS_PERMISSION_MODE must be fail or warn.',
  DOCTORALIA_MIN_ROWS_TOO_LOW: 'DOCTORALIA_APPOINTMENTS_MIN_ROWS must be at least 1800 for complete Doctoralia daily sync loads.',
  META_ACCOUNT_MISSING: 'META_AD_ACCOUNT_ID, META_AD_ACCOUNT_IDS, or FALLBACK_META_AD_ACCOUNT_ID secret is required.',
  GOOGLE_DOCTORALIA_SERVICE_ACCOUNT_MISSING: 'GOOGLE_DOCTORALIA_SERVICE_ACCOUNT or GOOGLE_ADS_SERVICE_ACCOUNT secret is required for Doctoralia appointments sync.',
  SUPABASE_ACCESS_TOKEN_FORMAT: 'SUPABASE_ACCESS_TOKEN format is invalid. Expected sbp_ token.',
  SUPABASE_PROJECT_REF_FORMAT: 'SUPABASE_PROJECT_REF format is invalid. Expected 20 lowercase alphanumeric characters.',
  UNKNOWN: 'Daily Sync configuration validation failed.',
};

function failCode(code) {
  const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.UNKNOWN;
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

function failMissingRequiredSecret(key) {
  if (!REQUIRED.includes(key)) {
    failCode('UNKNOWN');
    return;
  }
  console.error(`::error::${key} secret is required for Daily Sync Orchestrator.`);
  process.exitCode = 1;
}

for (const key of REQUIRED) {
  if (!hasValue(key)) failMissingRequiredSecret(key);
}

function validateDoctoraliaSheetConfiguration() {
  const sheetId = String(process.env.DOCTORALIA_SHEET_ID || '').trim();
  const appointmentsSheetId = String(process.env.DOCTORALIA_APPOINTMENTS_SHEET_ID || sheetId).trim();
  const driveFileId = String(process.env.DOCTORALIA_DRIVE_FILE_ID || sheetId).trim();
  const permissionModes = [
    String(process.env.DOCTORALIA_SYNC_PERMISSION_MODE || 'fail').trim().toLowerCase(),
    String(process.env.DOCTORALIA_APPOINTMENTS_PERMISSION_MODE || process.env.DOCTORALIA_SYNC_PERMISSION_MODE || 'fail').trim().toLowerCase(),
  ];

  if (appointmentsSheetId !== sheetId) failCode('DOCTORALIA_APPOINTMENTS_SHEET_MISMATCH');
  if (driveFileId !== sheetId) failCode('DOCTORALIA_DRIVE_FILE_MISMATCH');
  if (permissionModes.some((mode) => !['fail', 'warn'].includes(mode))) failCode('DOCTORALIA_PERMISSION_MODE_INVALID');

  if (hasValue('DOCTORALIA_APPOINTMENTS_MIN_ROWS')) {
    const minRows = Number.parseInt(process.env.DOCTORALIA_APPOINTMENTS_MIN_ROWS, 10);
    if (!Number.isFinite(minRows) || minRows < 1800) failCode('DOCTORALIA_MIN_ROWS_TOO_LOW');
  }
}

validateDoctoraliaSheetConfiguration();

if (!hasValue('META_AD_ACCOUNT_ID') && !hasValue('META_AD_ACCOUNT_IDS') && !hasValue('FALLBACK_META_AD_ACCOUNT_ID')) {
  failCode('META_ACCOUNT_MISSING');
}

if (!hasValue('GOOGLE_DOCTORALIA_SERVICE_ACCOUNT') && !hasValue('GOOGLE_ADS_SERVICE_ACCOUNT')) {
  failCode('GOOGLE_DOCTORALIA_SERVICE_ACCOUNT_MISSING');
} else {
  const doctoraliaCredential = process.env.GOOGLE_DOCTORALIA_SERVICE_ACCOUNT || process.env.GOOGLE_ADS_SERVICE_ACCOUNT;
  if (!readServiceAccountEmail(doctoraliaCredential)) {
    console.error('::error::Configured Google service account is not valid JSON with client_email and private_key fields.');
    process.exitCode = 1;
  } else {
    console.log('[daily-sync] Google service account configured for Doctoralia.');
  }
}

if (hasValue('SUPABASE_ACCESS_TOKEN') && !/^sbp_[A-Za-z0-9]+$/.test(process.env.SUPABASE_ACCESS_TOKEN)) {
  failCode('SUPABASE_ACCESS_TOKEN_FORMAT');
}

if (hasValue('SUPABASE_PROJECT_REF') && !/^[a-z0-9]{20}$/.test(process.env.SUPABASE_PROJECT_REF)) {
  failCode('SUPABASE_PROJECT_REF_FORMAT');
}

if (process.exitCode) process.exit(process.exitCode);

const missingRecommended = RECOMMENDED.filter((key) => {
  if (key === 'FALLBACK_META_AD_ACCOUNT_ID' && (hasValue('META_AD_ACCOUNT_ID') || hasValue('META_AD_ACCOUNT_IDS'))) return false;
  return !hasValue(key);
});
if (missingRecommended.length > 0) {
  console.warn(`::warning::Recommended Daily Sync secrets not set: ${missingRecommended.join(', ')}`);
}

console.log('Daily Sync required secret validation passed. Doctoralia appointment tab is code-owned as Base Completa Doctoralia.');
