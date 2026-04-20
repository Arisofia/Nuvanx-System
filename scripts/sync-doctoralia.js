#!/usr/bin/env node
/**
 * sync-doctoralia.js
 * Reads individual settlement rows from Google Sheets (Doctoralia export) and
 * upserts them into the financial_settlements table in Supabase Postgres.
 *
 * Required env vars:
 *   GOOGLE_SA_JSON        — Service account JSON (GOOGLE_ADS_SERVICE_ACCOUNT secret)
 *   DOCTORALIA_SHEET_ID   — Spreadsheet ID (e.g. 1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw)
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

const {
  GOOGLE_SA_JSON: SA_JSON,
  DOCTORALIA_SHEET_ID: SHEET_ID,
  DATABASE_URL,
  CLINIC_ID,
  SHEET_RANGE = 'A1:Z5000',
  SHEET_NAME,
} = process.env;

// ─── Validation ───────────────────────────────────────────────────────────────
if (!SA_JSON || !SHEET_ID || !DATABASE_URL || !CLINIC_ID) {
  console.error('[sync-doctoralia] Missing required env vars.');
  console.error('  Required: GOOGLE_SA_JSON, DOCTORALIA_SHEET_ID, DATABASE_URL, CLINIC_ID');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a header string: lower-case, strip accents, trim. */
function norm(str) {
  return (str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Find the first column whose header contains any of the given hint strings. */
function findCol(headers, ...hints) {
  const normed = headers.map(norm);
  for (const hint of hints) {
    const idx = normed.findIndex(h => h.includes(hint));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a date string in DD/MM/YYYY, DD-MM-YYYY or ISO 8601 formats.
 * Returns a Date or null.
 */
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00Z`);
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse a monetary value string: removes €, spaces, thousands dots; converts
 * comma decimal separator to period.
 */
function parseAmount(val) {
  if (!val && val !== 0) return 0;
  const clean = String(val)
    .replace(/[€$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
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
  console.log(`[sync-doctoralia] Headers (${headers.length}): ${headers.join(' | ')}`);

  const colId           = findCol(headers, 'id op', 'id_op', 'num op', 'operacion', 'operation', 'id');
  const colTemplate     = findCol(headers, 'plantilladescr', 'plantilla descr', 'plantilla', 'template descr', 'template');
  const colTemplateId   = findCol(headers, 'id plantilla', 'template_id', 'id_plantilla', 'cod plantilla');
  const colIntake       = findCol(headers, 'fecha ingreso', 'fecha inicio', 'ingreso', 'inicio', 'intake', 'alta', 'desde');
  const colSettled      = findCol(headers, 'fecha liquidaci', 'liquidaci', 'fecha liq', 'settled', 'f. liq');
  const colGross        = findCol(headers, 'importe bruto', 'bruto', 'gross', 'financiad', 'capital');
  const colDiscount     = findCol(headers, 'descuento', 'discount', 'bonific');
  const colNet          = findCol(headers, 'importe neto', 'importe liq', 'neto', 'net', 'liquidado');
  const colPayment      = findCol(headers, 'metodo pago', 'metodo de pago', 'pago', 'payment', 'forma pago');
  const colIntermediary = findCol(headers, 'intermediario', 'mediador', 'financiera', 'entidad');
  const colStatus       = findCol(headers, 'estado', 'status', 'situacion');

  if (colId === -1) {
    console.error('[sync-doctoralia] Could not find an ID column. Aborting.');
    console.error('  Hint: Sheet must have a column whose header contains "id", "operacion", "num op", etc.');
    process.exit(1);
  }
  if (colSettled === -1) {
    console.error('[sync-doctoralia] Could not find a settlement-date column. Aborting.');
    console.error('  Hint: Sheet must have a column whose header contains "liquidaci", "liq", "settled", etc.');
    process.exit(1);
  }

  console.log(`[sync-doctoralia] Column mapping: id=${colId} template=${colTemplate} intake=${colIntake} settled=${colSettled} gross=${colGross} discount=${colDiscount} net=${colNet} status=${colStatus}`);

  // ── 3. Connect to Postgres ────────────────────────────────────────────────
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  console.log('[sync-doctoralia] Connected to database.');

  // ── 4. Upsert rows ────────────────────────────────────────────────────────
  let upserted = 0;
  let skipped  = 0;

  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    const rawId  = row[colId]?.toString().trim();

    if (!rawId) { skipped++; continue; }

    const settledAt = parseDate(row[colSettled]);
    if (!settledAt) { skipped++; continue; }

    // Detect cancellation via status column
    let cancelledAt = null;
    if (colStatus !== -1) {
      const statusVal = norm(row[colStatus]);
      if (statusVal.includes('cancel') || statusVal.includes('baja') || statusVal.includes('anulad')) {
        cancelledAt = settledAt;
      }
    }

    const intakeAt    = colIntake      !== -1 ? parseDate(row[colIntake])       : null;
    const amountGross = colGross       !== -1 ? parseAmount(row[colGross])      : 0;
    const amountDisc  = colDiscount    !== -1 ? parseAmount(row[colDiscount])   : 0;
    const amountNet   = colNet         !== -1 ? parseAmount(row[colNet])        : amountGross - amountDisc;
    const payment     = colPayment     !== -1 ? (row[colPayment]?.trim() || null)     : null;
    const tmplName    = colTemplate    !== -1 ? (row[colTemplate]?.trim() || null)    : null;
    const tmplId      = colTemplateId  !== -1 ? (row[colTemplateId]?.trim() || null)  : null;
    const intermed    = colIntermediary !== -1 ? (row[colIntermediary]?.trim() || null) : null;

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
        rawId, CLINIC_ID, amountGross, amountDisc, amountNet,
        payment, tmplName, tmplId,
        settledAt.toISOString(),
        intakeAt?.toISOString() ?? null,
        cancelledAt?.toISOString() ?? null,
        intermed,
      ]
    );

    upserted++;
  }

  await db.end();
  console.log(`[sync-doctoralia] Done — ${upserted} rows upserted, ${skipped} skipped (blank/undated).`);
}

main().catch(err => {
  console.error('[sync-doctoralia] Fatal error:', err.message);
  process.exit(1);
});
