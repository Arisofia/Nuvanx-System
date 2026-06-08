#!/usr/bin/env node
'use strict';

/**
 * Syncs the Doctoralia appointments agenda from Google Sheets into
 * public.doctoralia_appointments_ingestion.
 *
 * Required env vars:
 *   GOOGLE_SA_JSON / GOOGLE_DOCTORALIA_SERVICE_ACCOUNT / GOOGLE_SA_JSON_FILE / GOOGLE_API_KEY
 *   DOCTORALIA_APPOINTMENTS_SHEET_ID or DOCTORALIA_SHEET_ID or DOCTORALIA_DRIVE_FILE_ID
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY
 *
 * Optional env vars:
 *   DOCTORALIA_APPOINTMENTS_SHEET_NAME (default: SHEET_NAME or Doctoralia)
 *   DOCTORALIA_APPOINTMENTS_SHEET_RANGE (default: A1:Z5000)
 *   DOCTORALIA_APPOINTMENTS_MIN_ROWS (default: 1; use 2200 for production completeness checks)
 *   DOCTORALIA_APPOINTMENTS_PERMISSION_MODE (fail|warn; default: fail)
 *
 * Flags:
 *   --dry-run  Fetch and summarize Google Sheets rows without writing to Supabase.
 */

const fs = require('node:fs');
const { google } = require('googleapis');
const {
  countIngestedRecords,
  recordsFromRows,
  summarize,
  upsertRecords,
} = require('./populate-doctoralia-appointments');

const DRY_RUN = process.argv.includes('--dry-run');
const SHEET_ID = (
  process.env.DOCTORALIA_APPOINTMENTS_SHEET_ID ||
  process.env.DOCTORALIA_SHEET_ID ||
  process.env.DOCTORALIA_DRIVE_FILE_ID ||
  ''
).trim();
const SHEET_NAME = process.env.DOCTORALIA_APPOINTMENTS_SHEET_NAME || process.env.SHEET_NAME || 'Doctoralia';
const SHEET_RANGE = process.env.DOCTORALIA_APPOINTMENTS_SHEET_RANGE || 'A1:Z5000';
const MIN_ROWS = parsePositiveInt(process.env.DOCTORALIA_APPOINTMENTS_MIN_ROWS, 1);
const PERMISSION_MODE = (process.env.DOCTORALIA_APPOINTMENTS_PERMISSION_MODE || 'fail').toLowerCase();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mask(value) {
  const text = String(value || '');
  if (text.length <= 12) return text ? '[redacted]' : '';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function maskError(error) {
  const message = error?.message || String(error || '');
  return message
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[redacted-google-token]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[redacted-jwt]');
}

function getServiceAccountJson() {
  const inline = process.env.GOOGLE_SA_JSON || process.env.GOOGLE_DOCTORALIA_SERVICE_ACCOUNT;
  if (inline) return inline;

  const filePath = process.env.GOOGLE_SA_JSON_FILE;
  if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');

  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY?.includes('BEGIN PRIVATE KEY')) {
    return JSON.stringify({
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID || 'unknown',
      private_key: process.env.GOOGLE_PRIVATE_KEY.replaceAll(String.raw`\n`, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
    });
  }

  return null;
}

function quoteSheetName(sheetName) {
  return `'${String(sheetName).replaceAll("'", "''")}'`;
}

function buildA1Range() {
  if (SHEET_RANGE.includes('!')) return SHEET_RANGE;
  return `${quoteSheetName(SHEET_NAME)}!${SHEET_RANGE}`;
}

async function getSheetsClient() {
  const serviceAccountJson = getServiceAccountJson();

  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
  }

  if (process.env.GOOGLE_API_KEY) {
    return google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
  }

  throw new Error('Missing Google Sheets authentication. Set GOOGLE_SA_JSON, GOOGLE_DOCTORALIA_SERVICE_ACCOUNT, GOOGLE_SA_JSON_FILE, GOOGLE_API_KEY, or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY.');
}

function isPermissionError(error) {
  const status = error?.code || error?.response?.status;
  return status === 403 || status === 404;
}

async function fetchRows() {
  if (!SHEET_ID) {
    throw new Error('Missing DOCTORALIA_APPOINTMENTS_SHEET_ID/DOCTORALIA_SHEET_ID/DOCTORALIA_DRIVE_FILE_ID.');
  }

  const sheets = await getSheetsClient();
  const range = buildA1Range();
  console.log(`[sync-doctoralia-appointments] Fetching spreadsheet ${mask(SHEET_ID)} range ${range}.`);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  return response.data.values || [];
}

async function main() {
  let rows;
  try {
    rows = await fetchRows();
  } catch (error) {
    if (PERMISSION_MODE === 'warn' && isPermissionError(error)) {
      console.warn(`::warning::[sync-doctoralia-appointments] Google Sheets access blocked: ${maskError(error)}`);
      return;
    }
    throw error;
  }

  const records = recordsFromRows(rows);
  const totals = summarize(records);
  console.log(`[sync-doctoralia-appointments] Parsed ${records.length} appointment rows.`);
  console.table(totals);

  if (records.length < MIN_ROWS) {
    throw new Error(`[sync-doctoralia-appointments] Parsed ${records.length} rows, below required minimum ${MIN_ROWS}. Check sheet name/range and export completeness.`);
  }

  if (DRY_RUN) {
    console.log('[sync-doctoralia-appointments] Dry run completed; no rows were written.');
    return;
  }

  await upsertRecords(records);
  const tableCount = await countIngestedRecords();
  console.log(`[sync-doctoralia-appointments] Sync completed. doctoralia_appointments_ingestion now has ${tableCount} rows.`);

  if (tableCount < MIN_ROWS) {
    throw new Error(`[sync-doctoralia-appointments] Table has ${tableCount} rows after sync, below required minimum ${MIN_ROWS}.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[sync-doctoralia-appointments] Fatal error:', maskError(error));
    if (error?.stack) console.error(maskError(error.stack));
    process.exit(1);
  });
}

module.exports = {
  buildA1Range,
  fetchRows,
  getServiceAccountJson,
  getSheetsClient,
  isPermissionError,
  main,
};
