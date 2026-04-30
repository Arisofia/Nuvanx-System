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
  const dmy = dmyRegex.exec(s);
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
  if (!val && val !== 0) return 0;
  const clean = String(val)
    .replaceAll('€', '')
    .replaceAll('$', '')
    .replaceAll(/\s/g, '')
    .replaceAll('.', '')
    .replaceAll(',', '.');
  const n = Number.parseFloat(clean);
  return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100;
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
  console.log(`[sync-doctoralia] Fetching spreadsheet ${SHEET_ID}, range ${range} …`);

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
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  console.log('[sync-doctoralia] Connected to database.');

  // ── 4. Upsert rows ────────────────────────────────────────────────────────
  let upserted = 0;
  let skipped  = 0;

  for (let i = 1; i < rows.length; i++) {
    const parsed = parseRow(rows[i], config);
    if (!parsed) {
      skipped++;
      continue;
    }

    try {
      await db.query(
        `INSERT INTO financial_settlements
           (id, clinic_id, amount_gross, amount_discount, amount_net,
            payment_method, template_name, template_id,
            settled_at, intake_at, cancelled_at, intermediary_name, source_system)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'doctoralia')
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
           source_system     = 'doctoralia'`,
        [
          parsed.rawId, CLINIC_ID, parsed.amountGross, parsed.amountDisc, parsed.amountNet,
          parsed.payment, parsed.tmplName, parsed.tmplId,
          parsed.settledAt.toISOString(),
          parsed.intakeAt?.toISOString() ?? null,
          parsed.cancelledAt?.toISOString() ?? null,
          parsed.intermed,
        ]
      );
      upserted++;
    } catch (rowError) {
      skipped++;
      console.warn(`[sync-doctoralia] Skipping row ${i + 1} due to DB error: ${rowError.message}`);
    }
  }

  await db.end();
  console.log(`[sync-doctoralia] Done — ${upserted} rows upserted, ${skipped} skipped (blank/undated).`);
}

main().catch(err => {
  console.error('[sync-doctoralia] Fatal error:', err.message);
  process.exit(1);
});
