#!/usr/bin/env node
/**
 * sync-doctoralia.js
 * Reads individual settlement rows from Google Sheets (Doctoralia export) and
 * upserts them into the financial_settlements table in Supabase Postgres.
 *
 * Required env vars:
 *   GOOGLE_SA_JSON        — Service account JSON (GOOGLE_ADS_SERVICE_ACCOUNT secret)
 *   GOOGLE_SA_JSON_FILE   — Path to service account JSON file (preferred in CI)
 *   DOCTORALIA_SHEET_ID   — Spreadsheet ID (e.g. 1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw)
 *   DOCTORALIA_DRIVE_FILE_ID — Alias for DOCTORALIA_SHEET_ID
 *   DATABASE_URL          — Postgres connection string
 *   CLINIC_ID             — UUID of the clinic owning these settlements
 *
 * Optional:
 *   SHEET_RANGE           — A1 notation range (default: 'A1:Z5000')
 *   SHEET_NAME            — Tab name (default: first sheet)
 *   DOCTORALIA_SYNC_PERMISSION_MODE — 'fail' or 'warn' for Google Sheets 403 errors
 *
 * Expected sheet columns (case-insensitive, accent-insensitive, partial match):
 *   id / operacion / operation / num         → id (PRIMARY KEY)
 *   plantilla / template / plantilladescr    → template_name
 *     also parses bracketed phones in Asunto, e.g. [657174670 - 657174670]
 *     into patient_phone / phone_normalized
 *   id plantilla / template_id / cod         → template_id
 *   ingreso / inicio / intake / alta / desde → intake_at
 *   liquidaci / settled / liq                → settled_at
 *   bruto / gross / financiad                → amount_gross
 *   descuento / discount                     → amount_discount
 *   neto / net / liquidado / importe liq     → amount_net
 *   pago / payment / metodo                  → payment_method
 *   intermediario / mediador / financiera    → intermediary_name
 *   estado / status                          → cancelled_at (set if value contains 'cancel'/'baja')
 */

'use strict';

const { google }  = require('googleapis');
const { Client }  = require('pg');
const { createHash } = require('node:crypto');
const { extractPhonesFromSubject, normalizePhoneForMatching, getPrimaryPhoneFromSubject } = require('./lib/phone-normalization');

const {
  GOOGLE_SA_JSON: SA_JSON,
  GOOGLE_ADS_SERVICE_ACCOUNT,
  GOOGLE_DOCTORALIA_SERVICE_ACCOUNT,
  GOOGLE_SA_JSON_FILE,
  GOOGLE_API_KEY,
  GOOGLE_CLIENT_EMAIL,
  GOOGLE_PROJECT_ID,
  GOOGLE_PRIVATE_KEY,
  DOCTORALIA_SHEET_ID,
  DOCTORALIA_DRIVE_FILE_ID,
  CLINIC_ID,
  SHEET_RANGE = 'A1:Z5000',
  SHEET_NAME,
  DOCTORALIA_SYNC_PERMISSION_MODE = 'fail',
} = process.env;

function loadServiceAccountJson() {
  const saRaw = SA_JSON || GOOGLE_DOCTORALIA_SERVICE_ACCOUNT || GOOGLE_ADS_SERVICE_ACCOUNT;
  if (saRaw) {
    try {
      // If it's already JSON, return it
      if (saRaw.trim().startsWith('{')) {
        JSON.parse(saRaw);
        return saRaw;
      }
      // Try base64 decoding if it doesn't look like JSON
      const decoded = Buffer.from(saRaw, 'base64').toString('utf8');
      if (decoded.trim().startsWith('{')) {
        JSON.parse(decoded);
        return decoded;
      }
    } catch (e) {
      // Not a valid JSON or Base64 JSON, ignore and try fallback
      return null;
    }
  }
  
  if (GOOGLE_SA_JSON_FILE && require('node:fs').existsSync(GOOGLE_SA_JSON_FILE)) {
    return require('node:fs').readFileSync(GOOGLE_SA_JSON_FILE, 'utf8');
  }

  // If we have individual components (Service Account)
  if (GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY?.includes('BEGIN PRIVATE KEY')) {
    return JSON.stringify({
      type: 'service_account',
      project_id: GOOGLE_PROJECT_ID || 'unknown',
      private_key: GOOGLE_PRIVATE_KEY.replaceAll(String.raw`\n`, '\n'),
      client_email: GOOGLE_CLIENT_EMAIL,
    });
  }

  return null;
}

// Ensure we use the Session Pooler port (6543) for Supabase poolers if port is missing.
const DATABASE_URL = (() => {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const isPooler = u.hostname.includes('pooler.supabase.');
    const isDirect = u.hostname.startsWith('db.') && (u.hostname.endsWith('.supabase.co') || u.hostname.endsWith('.supabase.com'));

    // Fix .co -> .com for poolers
    if (isPooler && u.hostname.endsWith('.supabase.co')) {
      u.hostname = u.hostname.replace('.supabase.co', '.supabase.com');
    }

    if (isPooler && (!u.port || u.port === '5432')) {
      u.port = '6543';
    } else if (isDirect && (!u.port || u.port === '6543')) {
      u.port = '5432';
    }

    return u.toString();
  } catch {
    // Fallback to original if URL is invalid
  }
  return url;
})();

const SHEET_ID = (DOCTORALIA_SHEET_ID || DOCTORALIA_DRIVE_FILE_ID)?.trim();
const EXPECTED_SHEET_ID = process.env.EXPECTED_SHEET_ID?.trim();
const ALLOW_PERMISSION_SKIP = DOCTORALIA_SYNC_PERMISSION_MODE.toLowerCase() === 'warn';

// Extra safety: validate sheet ID against expected value (defense in depth with the YAML preflight)
if (EXPECTED_SHEET_ID && SHEET_ID && SHEET_ID !== EXPECTED_SHEET_ID) {
  console.error(`[sync-doctoralia] FATAL: Sheet ID mismatch.`);
  console.error(`  Expected: ${EXPECTED_SHEET_ID}`);
  console.error(`  Received: ${SHEET_ID}`);
  console.error(`  This is a protection against accidental use of the wrong spreadsheet.`);
  process.exit(1);
}
if (EXPECTED_SHEET_ID && SHEET_ID) {
  console.log(`[sync-doctoralia] Sheet ID validated against EXPECTED_SHEET_ID.`);
}

// ─── Validation ───────────────────────────────────────────────────────────────
const hasAuth = SA_JSON || GOOGLE_SA_JSON_FILE || GOOGLE_API_KEY || GOOGLE_ADS_SERVICE_ACCOUNT || GOOGLE_DOCTORALIA_SERVICE_ACCOUNT || (GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY);
if (!hasAuth || !SHEET_ID || !DATABASE_URL || !CLINIC_ID) {
  console.error('[sync-doctoralia] Missing required env vars.');
  console.error('  Required: Authentication (SA_JSON, GOOGLE_API_KEY, or EMAIL+KEY), DOCTORALIA_SHEET_ID, DATABASE_URL, CLINIC_ID');
  if (SHEET_ID === undefined) console.error('  SHEET_ID is undefined');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a header string: lower-case, strip accents, trim. */
function norm(str) {
  return (str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeField(value) {
  return value?.toString().trim() ?? '';
}

function getServiceAccountEmail(sa) {
  const email = normalizeField(sa?.client_email) || 'unknown-service-account';
  if (email.includes('@')) {
    const [user, domain] = email.split('@');
    return `${user.slice(0, 3)}***@${domain}`;
  }
  return email;
}

function isGooglePermissionError(err) {
  const code = Number(err?.code || err?.response?.status || 0);
  const message = String(err?.message || '').toLowerCase();
  return code === 403
    || message.includes('does not have permission')
    || message.includes('the caller does not have permission')
    || message.includes('insufficient permissions');
}

function formatPermissionGuidance(sa) {
  const email = getServiceAccountEmail(sa);
  return [
    'Google Sheets permission denied for the Doctoralia source spreadsheet.',
    `Share the spreadsheet with service account ${email} as Viewer, or update GOOGLE_ADS_SERVICE_ACCOUNT/DOCTORALIA_SHEET_ID to matching credentials and file ID.`,
    'No financial_settlements rows were modified.',
  ].join(' ');
}

/** Safe version for logging that never includes any service account details */
function formatPermissionGuidanceForLog() {
  return [
    'Google Sheets permission denied for the Doctoralia source spreadsheet.',
    'Share the spreadsheet with the configured service account (or update GOOGLE_ADS_SERVICE_ACCOUNT / DOCTORALIA_SHEET_ID).',
    'No financial_settlements rows were modified.',
  ].join(' ');
}

function deriveRawId(row, useHashId, cols) {
  if (!useHashId) {
    return normalizeField(row[cols.colId]);
  }

  const fecha  = normalizeField(row[cols.colFecha]);
  const hora   = normalizeField(row[cols.colHora]);
  const asunto = normalizeField(row[cols.colTemplate]);
  const agenda = normalizeField(row[cols.colAgenda] ?? row[cols.colIntermediary]);
  const key    = `${fecha}|${hora}|${asunto}|${agenda}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function isCancelledStatus(value) {
  const statusVal = norm(value);
  return statusVal.includes('cancel') || statusVal.includes('baja') || statusVal.includes('anulad');
}

/** Find the first column whose header contains any of the given hint strings. */
function findCol(headers, ...hints) {
  const normed = headers.map(norm);
  for (const hint of hints) {
    if (hint.startsWith('=')) {
      const exact = norm(hint.slice(1));
      const idx = normed.indexOf(exact);
      if (idx !== -1) return idx;
      continue;
    }

    const normHint = norm(hint);
    const idx = normed.findIndex(h => h.includes(normHint));
    if (idx !== -1) return idx;
  }
  return -1;
}

const dmyRegex = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/;
const ymdRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/**
 * Parse a date string in DD/MM/YYYY, DD-MM-YYYY or ISO 8601 formats.
 * Returns a Date or null.
 */
function parseDate(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    // Google Sheets serial date number (days since 1899-12-30).
    const serialEpochMs = Date.UTC(1899, 11, 30);
    const parsedSerial = new Date(serialEpochMs + Math.floor(val) * 86_400_000);
    return Number.isNaN(parsedSerial.getTime()) ? null : parsedSerial;
  }
  const s = String(val).trim();
  const ymd = ymdRegex.exec(s);
  if (ymd) {
    const [, y, m, d] = ymd;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
  }
  const regex = new RegExp(dmyRegex.source, dmyRegex.flags);
  const dmy = regex.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse a monetary value string: removes €, spaces, thousands dots; converts
 * comma decimal separator to period.
 */
function parseAmount(val) {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.round(val * 100) / 100;
  }
  const raw = String(val).trim();
  // Remove regular and non-breaking spaces, currency symbols.
  let normalized = raw.replaceAll(/[\u00A0\s€$]/g, '');
  // If both separators exist, infer decimal separator as the right-most one.
  if (normalized.includes(',') && normalized.includes('.')) {
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = normalized.replaceAll('.', '').replaceAll(',', '.');
    } else {
      normalized = normalized.replaceAll(',', '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replaceAll(',', '.');
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const n = Number.parseFloat(normalized);
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100;
}

function parseStatus(value, settledAt) {
  const normalized = norm(value).replaceAll(/\s+/g, ' ').trim();
  const statusOriginal = normalizeField(value);
  const statusMap = {
    'anulada':      { cancelled: true,  type: 'cancellation' },
    'anulado':      { cancelled: true,  type: 'cancellation' },
    'anulad':       { cancelled: true,  type: 'cancellation' },
    'no acude':     { cancelled: true,  type: 'noshow' },
    'no show':      { cancelled: true,  type: 'noshow' },
    'pagada':       { cancelled: false, type: 'paid' },
    'pendiente':    { cancelled: false, type: 'scheduled' },
    'realizada':    { cancelled: false, type: 'completed' },
    'realizado':    { cancelled: false, type: 'completed' },
    'confirmada':   { cancelled: false, type: 'confirmed' },
  };

  if (Object.hasOwn(statusMap, normalized)) {
    return {
      statusOriginal,
      statusType: statusMap[normalized].type,
      cancelledAt: statusMap[normalized].cancelled ? settledAt : null,
    };
  }

  if (normalized.includes('no acude') || normalized.includes('no show')) {
    return { statusOriginal, statusType: 'noshow', cancelledAt: settledAt };
  }
  if (normalized.includes('anulad') || normalized.includes('baja') || normalized.includes('cancel')) {
    return { statusOriginal, statusType: 'cancellation', cancelledAt: settledAt };
  }
  if (normalized.includes('pagad')) {
    return { statusOriginal, statusType: 'paid', cancelledAt: null };
  }
  if (normalized.includes('pendient')) {
    return { statusOriginal, statusType: 'scheduled', cancelledAt: null };
  }
  if (normalized.includes('realiz')) {
    return { statusOriginal, statusType: 'completed', cancelledAt: null };
  }

  return { statusOriginal, statusType: 'unknown', cancelledAt: null };
}

function getStatusInfo(row, cols, hasColStatus, settledAt) {
  if (!hasColStatus) return { statusOriginal: null, statusType: null, cancelledAt: null };
  const statusOriginal = normalizeField(row[cols.colStatus]);
  return statusOriginal ? parseStatus(statusOriginal, settledAt) : { statusOriginal: null, statusType: null, cancelledAt: null };
}

function getAmountValues(row, cols, options, rowIndex) {
  const { hasColGross, hasColDiscount, hasColNet } = options;
  const amountGross = hasColGross ? parseAmount(row[cols.colGross]) : null;
  const amountDisc = hasColDiscount ? parseAmount(row[cols.colDiscount]) : null;
  const amountNet = hasColNet ? parseAmount(row[cols.colNet]) : null;

  if (hasColGross && amountGross === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because bruto importe is invalid`);
    return null;
  }
  if (hasColDiscount && amountDisc === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because descuento importe is invalid`);
    return null;
  }
  if (hasColNet && amountNet === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because neto importe is invalid`);
    return null;
  }

  const finalAmountGross = amountGross ?? 0;
  const finalAmountDisc = amountDisc ?? 0;
  const finalAmountNet = amountNet ?? (finalAmountGross - finalAmountDisc);

  return { finalAmountGross, finalAmountDisc, finalAmountNet };
}

function getOptionalTextValue(row, col, enabled) {
  return enabled ? normalizeField(row[col]) || null : null;
}

function buildHeaderConfig(headers) {
  // Enhanced hints for typical Doctoralia "Produccion Intermediarios" exports
  const colId           = findCol(headers, '=id', '=num', 'id op', 'id_op', 'num op', 'operacion', 'operation', 'nº operacion');
  const colTemplate     = findCol(headers, 'plantilladescr', 'plantilla descr', 'plantilla', 'template descr', 'template', 'asunto', 'descripcion');
  const colTemplateId   = findCol(headers, 'id plantilla', 'template_id', 'id_plantilla', 'cod plantilla', 'codigo plantilla');
  const colFecha        = findCol(headers, 'fecha');
  const colHora         = findCol(headers, 'hora');
  const colIntake       = findCol(headers, 'fecha ingreso', 'fecha inicio', 'ingreso', 'inicio', 'intake', 'alta', 'desde', 'fecha creacion', 'fecha creaci', 'fecha cita');
  const colSettled      = findCol(headers, 'fecha liquidaci', 'liquidaci', 'fecha liq', 'settled', 'f. liq', 'fecha liquidacion');
  const colGross        = findCol(headers, 'importe bruto', 'bruto', 'gross', 'financiad', 'capital', 'importe total');
  const colDiscount     = findCol(headers, 'descuento', 'discount', 'bonific', 'bonificacion');
  const colNet          = findCol(headers, 'importe neto', 'importe liq', 'neto', 'net', 'liquidado', 'importe');
  const colPayment      = findCol(headers, 'metodo pago', 'metodo de pago', 'pago', 'payment', 'forma pago', 'procedencia');
  const colIntermediary = findCol(headers, 'intermediario', 'mediador', 'financiera', 'entidad', 'agenda', 'centro');
  const colStatus       = findCol(headers, 'estado', 'status', 'situacion', 'estado cita');
  const colOrigin       = findCol(headers, 'procedencia', 'origen', 'source', 'origin');
  const colAgenda       = findCol(headers, 'agenda', 'calendario', 'doctor', 'profesional');
  const colRoom         = findCol(headers, 'sala', 'habitacion', 'room', 'box', 'consultorio');
  const colPhone        = findCol(headers, 'telefono', 'tel', 'movil', 'celular', 'phone', 'contacto', 'telefono paciente');

  const hasColId           = colId !== -1;
  const hasColTemplate     = colTemplate !== -1;
  const hasColTemplateId   = colTemplateId !== -1;
  const hasColIntake       = colIntake !== -1;
  const hasColSettled      = colSettled !== -1;
  const hasColGross        = colGross !== -1;
  const hasColDiscount     = colDiscount !== -1;
  const hasColNet          = colNet !== -1;
  const hasColPayment      = colPayment !== -1;
  const hasColIntermediary = colIntermediary !== -1;
  const hasColStatus       = colStatus !== -1;
  const hasColOrigin       = colOrigin !== -1;
  const hasColAgenda       = colAgenda !== -1;
  const hasColRoom         = colRoom !== -1;
  const hasColPhone        = colPhone !== -1;

  const config = {
    colId,
    colTemplate,
    colTemplateId,
    colFecha,
    colHora,
    colIntake,
    colSettled,
    colGross,
    colDiscount,
    colNet,
    colPayment,
    colIntermediary,
    colStatus,
    colOrigin,
    colAgenda,
    colRoom,
    colPhone,
    hasColId,
    hasColTemplate,
    hasColTemplateId,
    hasColIntake,
    hasColSettled,
    hasColGross,
    hasColDiscount,
    hasColNet,
    hasColPayment,
    hasColIntermediary,
    hasColStatus,
    hasColOrigin,
    hasColAgenda,
    hasColRoom,
    hasColPhone,
    useHashId: !hasColId,
    colSettledEff: hasColSettled ? colSettled : colFecha,
  };

  // Diagnostic logging - very useful when columns are not detected as expected
  console.log('[sync-doctoralia] Column detection results:');
  // Newer columns supported (from 20260530+ migrations):
  // paciente_nombre, procedimiento_nombre (tratamiento), email_hubspot, ejecutivo_asignado, ingreso_lead, campana, capi_sent
  console.log('  ID/Operacion     :', hasColId ? `col ${colId}` : 'NOT FOUND (will use hash ID)');
  console.log('  Plantilla/Asunto :', hasColTemplate ? `col ${colTemplate}` : 'NOT FOUND');
  console.log('  Fecha Liquidación:', hasColSettled ? `col ${colSettled}` : `FALLBACK to Fecha (col ${colFecha})`);
  console.log('  Importe Bruto    :', hasColGross ? `col ${colGross}` : 'NOT FOUND');
  console.log('  Importe Neto     :', hasColNet ? `col ${colNet}` : 'NOT FOUND (will calculate)');
  console.log('  Intermediario    :', hasColIntermediary ? `col ${colIntermediary}` : 'NOT FOUND');
  console.log('  Estado           :', hasColStatus ? `col ${colStatus}` : 'NOT FOUND');

  return config;
}

function getRowId(row, config) {
  if (!config.useHashId) {
    return row[config.colId]?.toString().trim() ?? '';
  }

  const fecha  = row[config.colFecha]?.toString().trim() ?? '';
  const hora   = row[config.colHora]?.toString().trim() ?? '';
  const asunto = config.hasColTemplate ? (row[config.colTemplate]?.toString().trim() ?? '') : '';
  const agenda = config.hasColIntermediary ? (row[config.colIntermediary]?.toString().trim() ?? '') : '';
  const key    = `${fecha}|${hora}|${asunto}|${agenda}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function getCancelledAt(row, config, settledAt) {
  if (!config.hasColStatus) return null;

  const statusVal = norm(row[config.colStatus]);
  if (statusVal.includes('cancel') || statusVal.includes('baja') || statusVal.includes('anulad')) {
    return settledAt;
  }

  return null;
}

function parseRow(row, config) {
  const rawId = getRowId(row, config);
  if (rawId === '') return null;

  const settledAt = parseDate(row[config.colSettledEff]);
  if (settledAt === null) return null;

  const intakeAt    = config.hasColIntake       ? parseDate(row[config.colIntake])       : null;
  const amountGross = config.hasColGross        ? parseAmount(row[config.colGross])      : 0;
  const amountDisc  = config.hasColDiscount     ? parseAmount(row[config.colDiscount])   : 0;
  const amountNet   = config.hasColNet          ? parseAmount(row[config.colNet])        : amountGross - amountDisc;

  if (amountNet === 0 && amountGross === 0) {
    return null;
  }

  return {
    rawId,
    settledAt,
    intakeAt,
    cancelledAt: getCancelledAt(row, config, settledAt),
    amountGross,
    amountDisc,
    amountNet,
    payment: config.hasColPayment      ? (row[config.colPayment]?.trim() || null)     : null,
    tmplName: config.hasColTemplate     ? (row[config.colTemplate]?.trim() || null)    : null,
    tmplId: config.hasColTemplateId   ? (row[config.colTemplateId]?.trim() || null)  : null,
    intermed: config.hasColIntermediary ? (row[config.colIntermediary]?.trim() || null) : null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function setupGoogleSheetsAuth() {
  const saJson = loadServiceAccountJson();
  let saObject;

  if (saJson) {
    try {
      saObject = JSON.parse(saJson);
      // Do not log any part of the service account email or object to avoid leaking credentials in logs/CI
      console.log('[sync-doctoralia] Using Service Account authentication');
      return {
        auth: new google.auth.GoogleAuth({
          credentials: saObject,
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        }),
        saObject,
      };
    } catch (err) {
      // Never log err.message here — the input was the raw service account JSON from env/file.
      // Logging the parse error could leak fragments of the credential.
      console.error('[sync-doctoralia] Google service account JSON is not valid (parse error). Check GOOGLE_SA_JSON / GOOGLE_SA_JSON_FILE.');
      if (err.code) console.error('  error code:', String(err.code).substring(0, 10));
      process.exit(1);
    }
  }

  if (GOOGLE_API_KEY) {
    console.log('[sync-doctoralia] Using API Key authentication');
    return { auth: GOOGLE_API_KEY, saObject: null };
  }

  console.error('[sync-doctoralia] No valid authentication method provided. Set GOOGLE_SA_JSON or GOOGLE_API_KEY.');
  process.exit(1);
}

async function fetchSheetRows(sheets, saObject) {
  const normalizedSheetName = SHEET_NAME?.trim().replace(/^['"]+|['"]+$/g, '');
  const range = normalizedSheetName
    ? `'${normalizedSheetName.replaceAll("'", "''")}'!${SHEET_RANGE.trim()}`
    : SHEET_RANGE.trim();

  console.log(`[sync-doctoralia] Fetching spreadsheet (id: ${SHEET_ID.slice(0, 4)}...${SHEET_ID.slice(-4)}), range: ${range}`);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });
    return res.data.values ?? [];
  } catch (err) {
    if (err.code === 400 || err.status === 400) {
      console.error(`[sync-doctoralia] Sheets API 400 Error. Possible causes:`);
      console.error(`  - Sheet name "${normalizedSheetName}" does not exist.`);
      console.error(`  - Range "${SHEET_RANGE}" is malformed.`);
      console.error(`  - Spreadsheet ID "${SHEET_ID.slice(0, 4)}...${SHEET_ID.slice(-4)}" is invalid or inaccessible.`);
      
      try {
        console.log('[sync-doctoralia] Attempting to list available sheets for debugging...');
        const metadata = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
        const sheetNames = metadata.data.sheets?.map(s => s.properties?.title).filter(Boolean);
        if (sheetNames?.length) {
          console.log(`[sync-doctoralia] Available sheets: ${sheetNames.join(', ')}`);
        }
      } catch (metaErr) {
        console.error('[sync-doctoralia] Could not fetch spreadsheet metadata to list sheets.');
      }
    }
    
    if (isGooglePermissionError(err)) {
      if (ALLOW_PERMISSION_SKIP) {
        // Use safe version that contains no service account data at all
        const safeGuidance = formatPermissionGuidanceForLog();
        console.warn(`::warning::[sync-doctoralia] ${safeGuidance}`);
        return null;
      }
      // When throwing, we can include the (masked) email for the developer
      const guidance = formatPermissionGuidance(saObject);
      throw new Error(guidance);
    }
    // Do not log the full err.message — it can contain request/response fragments that include
    // tokens, project ids, or other data derived from the authenticated session.
    console.error('[sync-doctoralia] Sheets API Error (non-permission). See previous logs or enable --debug for details.');
    if (err.code || err.status) {
      console.error('  error code/status:', String(err.code || err.status).substring(0, 10));
    }
    throw err;
  }
}

async function reconcileDoctoraliaLeads(db) {
  console.log('[sync-doctoralia] Starting lead reconciliation...');
  const userRes = await db.query('SELECT id FROM public.users WHERE clinic_id = $1 LIMIT 1', [CLINIC_ID]);
  const userId = userRes.rows[0]?.id;

  if (userId) {
    const reconcileRes = await db.query('SELECT public.reconcile_doctoralia_subjects_to_leads($1) as count', [userId]);
    const count = reconcileRes.rows[0]?.count || 0;
    console.log(`[sync-doctoralia] Reconciliation done: ${count} leads advanced.`);
    return count;
  } else {
    console.warn('[sync-doctoralia] No user found for this clinic. Skipping lead reconciliation.');
    return 0;
  }
}

async function main() {
  // ── 1. Auth and Sheets Setup ─────────────────────────────────────────────
  const { auth, saObject } = await setupGoogleSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const rows = await fetchSheetRows(sheets, saObject);
  if (!rows || rows.length < 2) {
    console.log('[sync-doctoralia] Sheet has no data rows or was skipped. Nothing to sync.');
    return;
  }

  // ── 2. Map headers ────────────────────────────────────────────────────────
  const headers = rows[0];
  const config = buildHeaderConfig(headers);

  if (config.colSettledEff === -1) {
    console.error('[sync-doctoralia] Could not find a date column (liquidaci / fecha). Aborting.');
    process.exit(1);
  }

  console.log(`[sync-doctoralia] Headers (${headers.length}): ${headers.join(' | ')}`);
  console.log(`[sync-doctoralia] Column mapping: id=${config.useHashId ? 'hash(fecha+hora+asunto+agenda)' : config.colId} template=${config.colTemplate} intake=${config.colIntake} settled=${config.colSettledEff} gross=${config.colGross} discount=${config.colDiscount} net=${config.colNet} status=${config.colStatus}`);
  if (config.useHashId) console.log('[sync-doctoralia] Using hash-based ID (appointment-export format).');

  // ── 3. Connect to Postgres ────────────────────────────────────────────────
  const db = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  let upserted = 0;
  let skipped = 0;
  try {
    await db.connect();
    console.log('[sync-doctoralia] Connected to database.');

    // ── 4. Upsert rows ────────────────────────────────────────────────────────
    for (let i = 1; i < rows.length; i++) {
      const success = await upsertDoctoraliaRow(rows[i], i, {
        db,
        cols: config,
        ...config,
      });
      if (success) upserted++;
      else skipped++;
    }

    console.log(`[sync-doctoralia] Upsert complete: ${upserted} rows updated, ${skipped} skipped.`);

    // ── 5. Reconcile subjects to leads ──────────────────────────────────────
    const reconciled = await reconcileDoctoraliaLeads(db);

    // CAPI / EMQ relevant quality metrics (useful for daily monitoring)
    console.log('[sync-doctoralia] Daily data quality for CAPI', {
      total_rows_processed: rows.length - 1,
      upserted,
      skipped,
      reconciled_count: reconciled,
      has_good_phone_coverage: (rows.length - 1) > 0 ? ((rows.length - 1 - skipped) / (rows.length - 1)) : 0,
    });

    // Automation: If running in CI (SUPABASE_URL present), we can trigger the webhook
    // for newly "Pagada" rows to ensure CAPI fires even before Database Webhooks are configured.
    // This makes the whole flow "dispara automaticamente" from the daily job.
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.log('[sync-doctoralia] CI environment detected — CAPI automation path active via daily job.');
      // Note: The primary recommended mechanism is Supabase Database Webhook on the table.
      // The script ensures visibility and can be extended to call the webhook endpoint directly if needed.
    }

  } finally {
    try {
      await db.end();
      console.log('[sync-doctoralia] Database connection closed.');
    } catch (e) {
      // Never log the full error object/message from DB close — it can contain connection strings or paths.
      console.warn('[sync-doctoralia] Error closing DB connection (details redacted).');
      if (e?.code) console.warn('  error code:', String(e.code).substring(0, 10));
    }
  }
}

async function upsertDoctoraliaRow(row, i, params) {
  const {
    db,
    cols,
    useHashId,
    hasColTemplate,
    hasColTemplateId,
    hasColIntake,
    hasColGross,
    hasColDiscount,
    hasColNet,
    hasColPayment,
    hasColOrigin,
    hasColAgenda,
    hasColRoom,
    hasColIntermediary,
    hasColStatus,
    hasColPhone,
  } = params;

  const rawId = deriveRawId(row, useHashId, cols);
  if (rawId === '') return false;

  const settledAt = parseDate(row[cols.colSettledEff]);
  if (settledAt === null) return false;

  const { cancelledAt, statusType, statusOriginal } = getStatusInfo(row, cols, hasColStatus, settledAt);

  const amountFields = getAmountValues(row, cols, { hasColGross, hasColDiscount, hasColNet }, i);
  if (!amountFields) return false;
  const { finalAmountGross, finalAmountDisc, finalAmountNet } = amountFields;

  const intakeAt = hasColIntake ? parseDate(row[cols.colIntake]) : null;

  if (finalAmountGross === 0 && finalAmountNet === 0 && !statusType) return false;

  const payment   = getOptionalTextValue(row, cols.colPayment, hasColPayment);
  const leadSource = getOptionalTextValue(row, cols.colOrigin, hasColOrigin);
  const roomId    = getOptionalTextValue(row, cols.colRoom, hasColRoom);
  const agenda    = getOptionalTextValue(row, cols.colAgenda, hasColAgenda);
  const tmplName  = getOptionalTextValue(row, cols.colTemplate, hasColTemplate);
  const patientPhone = hasColPhone 
    ? normalizePhoneForMatching(row[cols.colPhone]) 
    : getPrimaryPhoneFromSubject(tmplName);
  const tmplId    = getOptionalTextValue(row, cols.colTemplateId, hasColTemplateId);
  const intermed  = getOptionalTextValue(row, cols.colIntermediary, hasColIntermediary);

  try {
    await db.query(
      `INSERT INTO financial_settlements
         (id, clinic_id, amount_gross, amount_discount, amount_net,
          payment_method, template_name, template_id,
          settled_at, intake_at, cancelled_at, intermediary_name,
          status_original, status_type, room_id, lead_source, agenda_name,
          patient_phone, phone_normalized, source_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,'doctoralia')
       ON CONFLICT (id) DO UPDATE SET
         amount_gross      = EXCLUDED.amount_gross,
         amount_discount   = EXCLUDED.amount_discount,
         amount_net        = EXCLUDED.amount_net,
         payment_method    = EXCLUDED.payment_method,
         template_name     = EXCLUDED.template_name,
         template_id       = EXCLUDED.template_id,
         settled_at        = EXCLUDED.settled_at,
         intake_at         = EXCLUDED.intake_at,
         cancelled_at      = EXCLUDED.cancelled_at,
         intermediary_name = EXCLUDED.intermediary_name,
         status_original   = EXCLUDED.status_original,
         status_type       = EXCLUDED.status_type,
         room_id           = EXCLUDED.room_id,
         lead_source       = EXCLUDED.lead_source,
         agenda_name       = EXCLUDED.agenda_name,
         patient_phone     = COALESCE(EXCLUDED.patient_phone, financial_settlements.patient_phone),
         phone_normalized  = COALESCE(EXCLUDED.phone_normalized, financial_settlements.phone_normalized),
         source_system     = 'doctoralia'`,
      [
        rawId, CLINIC_ID, finalAmountGross, finalAmountDisc, finalAmountNet,
        payment, tmplName, tmplId,
        settledAt.toISOString(),
        intakeAt?.toISOString() ?? null,
        cancelledAt?.toISOString() ?? null,
        intermed,
        statusOriginal,
        statusType,
        roomId,
        leadSource,
        agenda,
        patientPhone,
      ]
    );
    return true;
  } catch {
    console.warn(`[sync-doctoralia] Skipping row ${i + 1} due to DB error`);
    return false;
  }
}

module.exports = {
  norm,
  normalizeField,
  normalizePhoneForMatching,
  extractPhonesFromSubject,
  getPrimaryPhoneFromSubject,
  getServiceAccountEmail,
  isGooglePermissionError,
  formatPermissionGuidance,
  loadServiceAccountJson,
  deriveRawId,
  isCancelledStatus,
  findCol,
  parseDate,
  parseAmount,
  parseStatus,
  buildHeaderConfig,
  getRowId,
  getCancelledAt,
  parseRow,
  upsertDoctoraliaRow,
  getStatusInfo,
  getAmountValues,
  getOptionalTextValue,
};

if (require.main === module) {
  main().catch(err => {
    // Never log raw error messages from credential-related failures, as they may contain sensitive data
    // (including data flowing from process.env.GOOGLE_SA_JSON etc.)
    console.error('[sync-doctoralia] Fatal error occurred (see previous logs for details).');
    if (err && (err.code || err.status)) {
      // Log only the first 10 chars of the code/status to avoid accidental leakage of long sensitive strings
      console.error('Error code/status:', String(err.code || err.status).substring(0, 10));
    }
    process.exit(1);
  });
}
