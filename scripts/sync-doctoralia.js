#!/usr/bin/env node
/**
 * sync-doctoralia.js
 * Reads individual settlement rows from Google Sheets (Doctoralia export) and
 * upserts them into the financial_settlements table in Supabase Postgres.
 *
 * Required env vars:
 *   GOOGLE_SA_JSON        — Service account JSON (GOOGLE_ADS_SERVICE_ACCOUNT secret)
 *   DOCTORALIA_SHEET_ID   — Spreadsheet ID (e.g. 1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw)
 *   DOCTORALIA_DRIVE_FILE_ID — Alias for DOCTORALIA_SHEET_ID
 *   DATABASE_URL          — Postgres connection string
 *   CLINIC_ID             — UUID of the clinic owning these settlements
 *
 * Optional:
 *   SHEET_RANGE           — A1 notation range (default: 'A1:Z5000')
 *   SHEET_NAME            — Tab name (default: first sheet)
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
  DOCTORALIA_SHEET_ID,
  DOCTORALIA_DRIVE_FILE_ID,
  DATABASE_URL,
  CLINIC_ID,
  SHEET_RANGE = 'A1:Z5000',
  SHEET_NAME,
} = process.env;

const SHEET_ID = DOCTORALIA_SHEET_ID || DOCTORALIA_DRIVE_FILE_ID;

// ─── Validation ───────────────────────────────────────────────────────────────
if (!SA_JSON || !SHEET_ID || !DATABASE_URL || !CLINIC_ID) {
  console.error('[sync-doctoralia] Missing required env vars.');
  console.error('  Required: GOOGLE_SA_JSON, DOCTORALIA_SHEET_ID or DOCTORALIA_DRIVE_FILE_ID, DATABASE_URL, CLINIC_ID');
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

/**
 * Parse a date string in DD/MM/YYYY, DD-MM-YYYY or ISO 8601 formats.
 * Returns a Date or null.
 */
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
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
  const raw = String(val).trim();
  let normalized = raw.replaceAll(/[ €$]/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replaceAll('.', '').replaceAll(',', '.');
  } else {
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
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because bruto importe is invalid: ${row[cols.colGross]}`);
    return null;
  }
  if (hasColDiscount && amountDisc === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because descuento importe is invalid: ${row[cols.colDiscount]}`);
    return null;
  }
  if (hasColNet && amountNet === null) {
    console.warn(`[sync-doctoralia] Skipping row ${rowIndex + 1} because neto importe es invalid: ${row[cols.colNet]}`);
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
  const colId           = findCol(headers, '=id', '=num', 'id op', 'id_op', 'num op', 'operacion', 'operation');
  const colTemplate     = findCol(headers, 'plantilladescr', 'plantilla descr', 'plantilla', 'template descr', 'template', 'asunto');
  const colTemplateId   = findCol(headers, 'id plantilla', 'template_id', 'id_plantilla', 'cod plantilla');
  const colFecha        = findCol(headers, 'fecha');
  const colHora         = findCol(headers, 'hora');
  const colIntake       = findCol(headers, 'fecha ingreso', 'fecha inicio', 'ingreso', 'inicio', 'intake', 'alta', 'desde', 'fecha creacion', 'fecha creaci');
  const colSettled      = findCol(headers, 'fecha liquidaci', 'liquidaci', 'fecha liq', 'settled', 'f. liq');
  const colGross        = findCol(headers, 'importe bruto', 'bruto', 'gross', 'financiad', 'capital');
  const colDiscount     = findCol(headers, 'descuento', 'discount', 'bonific');
  const colNet          = findCol(headers, 'importe neto', 'importe liq', 'neto', 'net', 'liquidado', 'importe');
  const colPayment      = findCol(headers, 'metodo pago', 'metodo de pago', 'pago', 'payment', 'forma pago', 'procedencia');
  const colIntermediary = findCol(headers, 'intermediario', 'mediador', 'financiera', 'entidad', 'agenda');
  const colStatus       = findCol(headers, 'estado', 'status', 'situacion');
  const colOrigin       = findCol(headers, 'procedencia', 'origen', 'source', 'origin');
  const colAgenda       = findCol(headers, 'agenda', 'calendario', 'doctor');
  const colRoom         = findCol(headers, 'sala', 'habitacion', 'room', 'box');

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
    useHashId: !hasColId,
    colSettledEff: hasColSettled ? colSettled : colFecha,
  };
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

async function main() {
  // ── 1. Auth with Google service account ──────────────────────────────────
  let sa;
  try {
    sa = JSON.parse(SA_JSON);
  } catch {
    console.error('[sync-doctoralia] GOOGLE_SA_JSON is not valid JSON.');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const range = SHEET_NAME ? `${SHEET_NAME}!${SHEET_RANGE}` : SHEET_RANGE;
  // Avoid logging sensitive values in plain text.
  console.log('[sync-doctoralia] Fetching spreadsheet (id hidden), range masked.');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
  });

  const rows = res.data.values ?? [];
  if (rows.length < 2) {
    console.log('[sync-doctoralia] Sheet has no data rows. Nothing to sync.');
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
        useHashId: config.useHashId,
        hasColTemplate: config.hasColTemplate,
        hasColTemplateId: config.hasColTemplateId,
        hasColIntake: config.hasColIntake,
        hasColSettled: config.hasColSettled,
        hasColGross: config.hasColGross,
        hasColDiscount: config.hasColDiscount,
        hasColNet: config.hasColNet,
        hasColPayment: config.hasColPayment,
        hasColOrigin: config.hasColOrigin,
        hasColAgenda: config.hasColAgenda,
        hasColRoom: config.hasColRoom,
        hasColIntermediary: config.hasColIntermediary,
        hasColStatus: config.hasColStatus,
      });
      if (success) upserted++;
      else skipped++;
    }

  } finally {
    try {
      await db.end();
      console.log('[sync-doctoralia] Database connection closed.');
    } catch (e) {
      console.warn('[sync-doctoralia] Error closing DB connection:', e?.message || e);
    }
  }
  console.log(`[sync-doctoralia] Done — ${upserted} rows upserted, ${skipped} skipped (blank/undated).`);
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
  const patientPhone = getPrimaryPhoneFromSubject(tmplName);
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
  } catch (rowError) {
    console.warn(`[sync-doctoralia] Skipping row ${i + 1} due to DB error: ${rowError.message}`);
    return false;
  }
}

module.exports = {
  norm,
  normalizeField,
  normalizePhoneForMatching,
  extractPhonesFromSubject,
  getPrimaryPhoneFromSubject,
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
    console.error('[sync-doctoralia] Fatal error:', err.message);
    process.exit(1);
  });
}
