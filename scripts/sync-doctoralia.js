#!/usr/bin/env node
/**
 * sync-doctoralia.js
 * Reads individual settlement rows from Google Sheets (Doctoralia export) and
 * upserts them into the financial_settlements table in Supabase Postgres.
 *
 * Required env vars:
 *   GOOGLE_SA_JSON        — Service account JSON (GOOGLE_ADS_SERVICE_ACCOUNT secret)
 *   GOOGLE_SA_JSON_FILE   — Path to service account JSON file (preferred in CI)
 *   DOCTORALIA_SHEET_ID   — Spreadsheet ID
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
 *     also parses bracketed phones in Asunto, e.g. [000000000 - 000000000]
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
  GOOGLE_SA_JSON,
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

const SA_JSON = GOOGLE_SA_JSON || GOOGLE_ADS_SERVICE_ACCOUNT || GOOGLE_DOCTORALIA_SERVICE_ACCOUNT;

function loadServiceAccountJson() {
  if (SA_JSON) {
    try {
      JSON.parse(SA_JSON);
      return SA_JSON;
    } catch {
      // Not a valid JSON, ignore and try fallback
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
      private_key: GOOGLE_PRIVATE_KEY.replaceAll(String.raw`\\n`, '\n'),
      client_email: GOOGLE_CLIENT_EMAIL,
    });
  }

  return null;
}

// Normalize DATABASE_URL:
// - Prefer/keep Session Pooler (port 5432, host aws-*-pooler.supabase.com) for reliability.
// - Transaction pooler is 6543; the CI action rewrites tx -> session where appropriate.
// - Direct db.* hosts are IPv6-only for this project → rewrite attempts or warnings elsewhere.
const DATABASE_URL = (() => {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const isPooler = u.hostname.includes('pooler.supabase.');
    const isDirect = u.hostname.startsWith('db.') && (u.hostname.endsWith('.supabase.co') || u.hostname.endsWith('.supabase.com'));

    // Fix .co -> .com for poolers (some older strings)
    if (isPooler && u.hostname.endsWith('.supabase.co')) {
      u.hostname = u.hostname.replace('.supabase.co', '.supabase.com');
    }

    // Default to session pooler port (5432) for known host patterns if port is missing or uses tx pooler port
    if ((isPooler && !u.port) || (isDirect && (!u.port || u.port === '6543'))) {
      u.port = '5432';
    }

    return u.toString();
  } catch {
    // Fallback to original if URL is invalid
  }
  return url;
})();

const SHEET_ID = (DOCTORALIA_SHEET_ID || DOCTORALIA_DRIVE_FILE_ID)?.trim();
const ALLOW_PERMISSION_SKIP = DOCTORALIA_SYNC_PERMISSION_MODE.toLowerCase() === 'warn';

// ─── Validation (only when executed directly as the sync script) ──────────────
// This prevents require() from test files / other modules from exiting the process
// when prod env vars (DB, SA, SHEET_ID, CLINIC_ID) are not present. Pure helpers
// (parseAsunto, normalize*, buildHeaderConfig, parseRow etc) remain usable.
if (require.main === module) {
  const hasAuth = SA_JSON || GOOGLE_SA_JSON_FILE || GOOGLE_API_KEY || (GOOGLE_CLIENT_EMAIL && GOOGLE_PRIVATE_KEY);
  if (!hasAuth || !SHEET_ID || !DATABASE_URL || !CLINIC_ID) {
    console.error('[sync-doctoralia] Missing required env vars.');
    console.error('  Required: Authentication (SA_JSON, GOOGLE_API_KEY, or EMAIL+KEY), DOCTORALIA_SHEET_ID, DATABASE_URL, CLINIC_ID');
    if (SHEET_ID === undefined) console.error('  SHEET_ID is undefined');
    process.exit(1);
  }
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

function maskSensitive(text) {
  if (!text) return text;
  const str = String(text);
  return str
    // Mask passwords in connection strings: postgres://user:password@host
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@\s]+)(@)/gi, '$1****$3')
    // Mask emails: keep first 3 chars, then ***, then @domain
    .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (match, p1, p2) => {
      const maskedP1 = p1.length > 3 ? p1.slice(0, 3) + '***' : '***';
      return maskedP1 + '@' + p2;
    });
}

function getServiceAccountEmail(sa) {
  return normalizeField(sa?.client_email) || 'unknown-service-account';
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
  return [
    'Google Sheets permission denied for the Doctoralia source spreadsheet.',
    'Share the spreadsheet with the configured service account as Viewer, or update GOOGLE_ADS_SERVICE_ACCOUNT/DOCTORALIA_SHEET_ID to matching credentials and file ID.',
    'No financial_settlements rows were modified.',
  ].join(' ');
}

/**
 * Parses the "Asunto" column (F) using a robust regex.
 * Handles cases where the patient name itself contains parentheses.
 * 
 * Expected format: "398. PATIENT NAME (REPRESENTATIVE) [123456789] (TREATMENT NAME)"
 */
function parseAsunto(asunto) {
  if (!asunto) return null;
  const pattern = /^(\d+)\.\s+(.*?)\s+\[(.*?)\]\s+\((.*?)\)\s*$/;
  const match = pattern.exec(String(asunto));
  
  if (!match) return null;

  return {
    id: match[1],
    nombre: match[2].trim(),
    telefono: match[3].trim(),
    tratamiento: match[4].trim()
  };
}

function deriveRawId(row, useHashId, cols) {
  if (!useHashId) {
    return normalizeField(row[cols.colId]);
  }

  // Fallback: Try robust parsing from Asunto column
  if (cols?.hasColTemplate) {
    const asunto = normalizeField(row[cols.colTemplate]);
    const parsed = parseAsunto(asunto);
    if (parsed?.id) {
      return parsed.id;
    }
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

  // Priority 1: If we have a dedicated Net column (usually "Importe" in this sheet), prefer it
  let amountNet = hasColNet ? parseAmount(row[cols.colNet]) : null;
  let amountGross = hasColGross ? parseAmount(row[cols.colGross]) : null;
  let amountDisc = hasColDiscount ? parseAmount(row[cols.colDiscount]) : null;

  // If we only have one "Importe" column (common in Doctoralia exports), treat it as net
  if (!hasColGross && !hasColDiscount && hasColNet && amountNet !== null) {
    amountGross = amountNet;
    amountDisc = 0;
  }

  if (hasColGross && amountGross === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because bruto importe is invalid: ${row[cols.colGross]}`);
    return null;
  }
  if (hasColDiscount && amountDisc === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because descuento importe is invalid: ${row[cols.colDiscount]}`);
    return null;
  }
  if (hasColNet && amountNet === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because importe is invalid: ${row[cols.colNet]}`);
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
  // Optimized for the exact "Produccion Intermediarios" sheet structure (as of June 2026 inspection)
  const colId           = findCol(headers, '=id', '=num', 'id op', 'id_op', 'num op', 'operacion', 'operation', 'm');
  const colTemplate     = findCol(headers, 'plantilladescr', 'plantilla descr', 'plantilla', 'template descr', 'template', 'asunto', 'f');
  const colTemplateId   = findCol(headers, 'id plantilla', 'template_id', 'id_plantilla', 'cod plantilla');
  const colFecha        = findCol(headers, 'fecha', 'b');
  const colHora         = findCol(headers, 'hora', 'c');
  const colIntake       = findCol(headers, 'fecha ingreso', 'fecha inicio', 'ingreso', 'inicio', 'intake', 'alta', 'desde', 'fecha creacion', 'fecha creaci', 'd');
  const colSettled      = findCol(headers, 'fecha liquidaci', 'liquidaci', 'fecha liq', 'settled', 'f. liq', 'b'); // B is the main date
  const colGross        = findCol(headers, 'importe bruto', 'bruto', 'gross', 'financiad', 'capital');
  const colDiscount     = findCol(headers, 'descuento', 'discount', 'bonific');
  const colNet          = findCol(headers, 'importe neto', 'importe liq', 'neto', 'net', 'liquidado', 'importe', 'k'); // K = Importe
  const colPayment      = findCol(headers, 'metodo pago', 'metodo de pago', 'pago', 'payment', 'forma pago', 'procedencia');
  const colIntermediary = findCol(headers, 'intermediario', 'mediador', 'financiera', 'entidad', 'agenda', 'g');
  const colStatus       = findCol(headers, 'estado', 'status', 'situacion', 'a');
  const colOrigin       = findCol(headers, 'procedencia', 'origen', 'source', 'origin', 'j');
  const colAgenda       = findCol(headers, 'agenda', 'calendario', 'doctor', 'g');
  const colRoom         = findCol(headers, 'sala', 'habitacion', 'room', 'box', 'h');
  const colPhone        = findCol(headers, 'telefono', 'tel', 'movil', 'celular', 'phone', 'contact', 'o'); // O = Teléfono
  const colCampaign     = findCol(headers, 'campaña', 'campaign', 'u'); // U = CAMPAÑA
  const colName         = findCol(headers, 'nombre', 'name', 'n'); // N = Nombre
  const colTratamiento  = findCol(headers, 'tratamiento', 'p'); // P = Tratamiento

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

  return {
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
    hasColCampaign: colCampaign !== -1,
    hasColName: colName !== -1,
    hasColTratamiento: colTratamiento !== -1,
    colCampaign,
    colName,
    colTratamiento,
    useHashId: !hasColId,
    colSettledEff: hasColSettled ? colSettled : colFecha,
  };
}

function getRowId(row, config) {
  if (!config.useHashId) {
    return row[config.colId]?.toString().trim() ?? '';
  }

  // Fallback: Try to extract a real ID from the Asunto column (F) using robust regex
  if (config.hasColTemplate) {
    const asunto = row[config.colTemplate]?.toString().trim() ?? '';
    const parsed = parseAsunto(asunto);
    if (parsed && parsed.id) {
      return parsed.id;
    }
  }

  // Last resort: hash-based ID (existing behavior)
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

  // Try to parse rich data from Asunto (F) as fallback / enrichment
  let parsedFromAsunto = null;
  if (config.hasColTemplate) {
    const asunto = row[config.colTemplate]?.toString().trim() ?? '';
    parsedFromAsunto = parseAsunto(asunto);
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

    // Fallback / enrichment from Asunto column when dedicated columns are missing
    nombre: config.hasColName ? (row[config.colName]?.trim() || null) : (parsedFromAsunto?.nombre || null),
    telefono: config.hasColPhone ? (row[config.colPhone]?.trim() || null) : (parsedFromAsunto?.telefono || null),
    tratamiento: config.hasColTratamiento ? (row[config.colTratamiento]?.trim() || null) : (parsedFromAsunto?.tratamiento || null),
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
      console.log('[sync-doctoralia] Using Google Service Account credentials from environment.');
      return {
        auth: new google.auth.GoogleAuth({
          credentials: saObject,
          scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        }),
        saObject,
      };
    } catch (err) {
      console.error(`[sync-doctoralia] Google service account JSON is not valid: ${maskSensitive(err.message)}`);
      process.exit(1);
    }
  }

  if (GOOGLE_API_KEY) {
    return { auth: GOOGLE_API_KEY, saObject: null };
  }

  console.error('[sync-doctoralia] No valid authentication method provided. Set GOOGLE_SA_JSON or GOOGLE_API_KEY.');
  process.exit(1);
}

async function fetchSheetRows(sheets, saObject) {
  console.log(`[sync-doctoralia] Fetching spreadsheet metadata (id: ${SHEET_ID.slice(0, 4)}...${SHEET_ID.slice(-4)})`);

  // First, get the list of sheets to find the correct title
  let targetSheetTitle = null;
  let availableSheets = [];

  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'sheets.properties.title,sheets.properties.sheetId,sheets.properties.gridProperties'
    });

    const sheetsList = meta.data.sheets || [];
    availableSheets = sheetsList.map(s => s.properties.title);

    console.log(`[sync-doctoralia] Available sheets in spreadsheet: ${availableSheets.join(' | ')}`);

    if (SHEET_NAME) {
      const normalized = SHEET_NAME.trim().toLowerCase();
      const found = sheetsList.find(s => 
        s.properties.title.toLowerCase() === normalized ||
        s.properties.title.toLowerCase().includes(normalized)
      );
      if (found) targetSheetTitle = found.properties.title;
    }

    if (!targetSheetTitle && sheetsList.length > 0) {
      // Fallback to first sheet
      targetSheetTitle = sheetsList[0].properties.title;
      console.log(`[sync-doctoralia] No exact sheet match for "${SHEET_NAME}", using first sheet: "${targetSheetTitle}"`);
    }
  } catch (metaErr) {
    console.warn(`[sync-doctoralia] Could not fetch spreadsheet metadata: ${maskSensitive(metaErr.message)}. Will try direct range.`);
  }

  let effectiveRange = SHEET_RANGE.trim();
  if (targetSheetTitle) {
    // Try to get actual dimensions from metadata to avoid overly large ranges
    // that can cause "invalid argument" on certain sheets or when ID is wrong.
    const sheetMeta = sheetsList.find(s => s.properties.title === targetSheetTitle);
    const gp = sheetMeta?.properties?.gridProperties;
    if (gp) {
      const maxRows = Math.min(gp.rowCount || 5000, 20000);
      // If the configured range looks like A1:LETTER9999, cap the row number.
      if (/^A1:[A-Z]+\d+$/.test(effectiveRange)) {
        effectiveRange = effectiveRange.replace(/\d+$/, String(maxRows));
      } else if (effectiveRange === 'A1:Z5000' || effectiveRange.includes(':Z')) {
        effectiveRange = `A1:Z${maxRows}`;
      }
    }
  }

  const range = targetSheetTitle 
    ? `'${targetSheetTitle.replaceAll("'", "''")}'!${effectiveRange}`
    : effectiveRange;

  console.log(`[sync-doctoralia] Final range: ${range}`);

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });
    let values = res.data.values ?? [];

    // Trim trailing completely empty rows OR "mostly empty" rows that only contain
    // default values in trailing columns (e.g. "NUVANX Medicina Estética Láser" only in col T/Clínica,
    // with A-S empty). These 170-row tails from exports cause processing noise and can
    // contribute to range/arg issues if the sheet is large.
    // We consider a data row "empty" for trimming if its primary key columns are blank.
    const beforeTrim = values.length;
    while (values.length > 0) {
      const last = values[values.length - 1] || [];
      const isAllEmpty = last.every((c) => c == null || String(c).trim() === '');
      // Key columns for this dataset: col 5 (Asunto/F, the unique key), col 1 (Fecha/B)
      const keyColsBlank = (last[5] == null || String(last[5]).trim() === '') &&
                           (last[1] == null || String(last[1]).trim() === '');
      if (isAllEmpty || keyColsBlank) {
        values.pop();
      } else {
        break;
      }
    }
    const trimmed = beforeTrim - values.length;
    if (trimmed > 0) {
      console.log(`[sync-doctoralia] Trimmed ${trimmed} trailing empty or mostly-empty rows (e.g. clinic name only in last column).`);
    }
    return values;
  } catch (err) {
    if (isGooglePermissionError(err)) {
      const guidance = formatPermissionGuidance(saObject);
      if (ALLOW_PERMISSION_SKIP) {
        console.warn(`::warning::[sync-doctoralia] ${maskSensitive(guidance)}`);
        return null;
      }
      throw new Error(guidance);
    }

    console.error(`[sync-doctoralia] Sheets API Error: ${maskSensitive(err.message)}`);
    if (err.errors) {
      console.error('[sync-doctoralia] Details:', maskSensitive(JSON.stringify(err.errors, null, 2)));
    } else if (err.response?.data) {
      console.error('[sync-doctoralia] Response Data:', maskSensitive(JSON.stringify(err.response.data, null, 2)));
    }

    if (availableSheets.length > 0) {
      console.error(`[sync-doctoralia] Available sheets were: ${availableSheets.join(' | ')}`);
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
  } else {
    console.warn('[sync-doctoralia] No user found for this clinic. Skipping lead reconciliation.');
  }
}

async function main() {
  console.log('[sync-doctoralia] Starting Doctoralia financial sync...');

  // ── 1. Auth and Sheets Setup ─────────────────────────────────────────────
  const { auth, saObject } = await setupGoogleSheetsAuth();

  if (!saObject && GOOGLE_API_KEY) {
    console.log('[sync-doctoralia] Using GOOGLE_API_KEY for authentication (limited permissions).');
  }

  const sheets = google.sheets({ version: 'v4', auth });

  const rows = await fetchSheetRows(sheets, saObject);
  if (!rows || rows.length < 2) {
    console.log('[sync-doctoralia] Sheet has no data rows or was skipped. Nothing to sync.');
    return;
  }

  console.log(`[sync-doctoralia] Data rows after trimming trailing empties: ${rows.length - 1}`);

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
    await reconcileDoctoraliaLeads(db);

  } finally {
    try {
      await db.end();
      console.log('[sync-doctoralia] Database connection closed.');
    } catch (e) {
      console.warn('[sync-doctoralia] Error closing DB connection:', e?.message || e);
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
  const tmplId    = getOptionalTextValue(row, cols.colTemplateId, hasColTemplateId);
  const intermed  = getOptionalTextValue(row, cols.colIntermediary, hasColIntermediary);

  // Improved phone extraction using parseAsunto as strong fallback
  let patientPhone = null;
  if (hasColPhone) {
    patientPhone = normalizePhoneForMatching(row[cols.colPhone]);
  }
  if (!patientPhone && hasColTemplate) {
    const asunto = row[cols.colTemplate]?.toString().trim() ?? '';
    const parsed = parseAsunto(asunto);
    if (parsed && parsed.telefono) {
      patientPhone = normalizePhoneForMatching(parsed.telefono);
    } else {
      patientPhone = getPrimaryPhoneFromSubject(asunto);
    }
  }

  try {
    await db.query(
      `INSERT INTO financial_settlements
         (id, clinic_id, amount_gross, amount_discount, amount_net,
          payment_method, template_name, template_id,
          settled_at, intake_at, cancelled_at, intermediary_name,
          status_original, status_type, room_id, lead_source, agenda_name,
          patient_phone, phone_normalized, source_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'doctoralia')
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
        patientPhone ? normalizePhoneForMatching(patientPhone) : null,  // phone_normalized as 19th param
      ]
    );
    return true;
  } catch (rowError) {
    console.warn(`[sync-doctoralia] Skipping row ${i + 1} due to DB error: ${maskSensitive(rowError.message)}`);
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
  parseAsunto,
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
  main().catch(() => {
    console.error('[sync-doctoralia] Fatal error. Enable secure debug logging to inspect details.');
    process.exit(1);
  });
}
