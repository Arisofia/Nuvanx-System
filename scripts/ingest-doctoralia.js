/**
 * ingest-doctoralia.js
 * ---------------------
 * Reads the Doctoralia appointments export from a Google Sheet using a service
 * account, then upserts rows into:
 *   - `appointments`           (all rows)
 *   - `financial_settlements`  (rows with Importe > 0 and not cancelled)
 *
 * Column headers expected (current Doctoralia export format):
 *   Estado | Fecha | Hora | Fecha creación | Hora creación |
 *   Asunto | Agenda | Sala/Box | Confirmada | Procedencia | Importe | Acciones
 *
 * Usage:
 *   DOCTORALIA_SHEET_ID=<id> node scripts/ingest-doctoralia.js
 *
 * Required env vars (or in backend/.env):
 *   DOCTORALIA_SHEET_ID        — Google Sheet ID (from URL)
 *   SUPABASE_URL               — e.g. https://ssvvuuysgxyqvmovrlvk.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key (bypasses RLS)
 *   GOOGLE_SERVICE_ACCOUNT_FILE — path to service account JSON
 *                                 (default: backend/google-service-account.json)
 *   CLINIC_ID                  — UUID of the clinic in Supabase
 *                                 (4207023b-eac1-4249-bf0f-d9b1e36a5d7a)
 *
 * Optional:
 *   SHEET_RANGE  — e.g. "Sheet1!A:L" (default: "Sheet1!A:L")
 *   DRY_RUN=1   — print rows without inserting
 */

'use strict';

const path  = require('path');
const fs    = require('fs');
const crypto = require('crypto');

// ── Load env ─────────────────────────────────────────────────────────────────
const dotenvPath = path.join(__dirname, '..', 'backend', '.env');
if (fs.existsSync(dotenvPath)) require('dotenv').config({ path: dotenvPath });

const { google }    = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────
const SHEET_ID   = process.env.DOCTORALIA_SHEET_ID || process.argv[2];
const RANGE      = process.env.SHEET_RANGE || 'Sheet1!A:L';
const DRY_RUN    = process.env.DRY_RUN === '1';
const CLINIC_ID  = process.env.CLINIC_ID;

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SA_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE
  || path.join(__dirname, '..', 'backend', 'google-service-account.json');

if (!SHEET_ID) {
  console.error('Error: DOCTORALIA_SHEET_ID env var or first CLI argument is required.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}
if (!CLINIC_ID) {
  console.error('Error: CLINIC_ID is required.');
  process.exit(1);
}

// ── Service account — extract first valid JSON object from the file ───────────
function loadServiceAccount(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  // The file may have extra content (env vars) appended after the JSON object.
  // Find the closing brace of the top-level object.
  let depth = 0, end = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error('Could not find valid JSON object in service account file');
  return JSON.parse(raw.slice(0, end + 1));
}

// ── Column index map (built from header row) ──────────────────────────────────
const KNOWN_HEADERS = {
  'estado':           'estado',
  'fecha':            'fecha',
  'hora':             'hora',
  'fecha creación':   'fecha_creacion',
  'fecha creacion':   'fecha_creacion',
  'hora creación':    'hora_creacion',
  'hora creacion':    'hora_creacion',
  'asunto':           'asunto',
  'agenda':           'agenda',
  'sala/box':         'sala_box',
  'sala':             'sala_box',
  'confirmada':       'confirmada',
  'procedencia':      'procedencia',
  'importe':          'importe',
  'acciones':         null,  // ignored
};

function buildColMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = (h || '').trim().toLowerCase();
    const field = KNOWN_HEADERS[key];
    if (field !== undefined && field !== null) map[field] = i;
  });
  return map;
}

function get(row, map, field) {
  const idx = map[field];
  return idx !== undefined ? (row[idx] || '').toString().trim() : '';
}

// ── Date helpers ──────────────────────────────────────────────────────────────
// Doctoralia dates are in ES format: DD/MM/YYYY  and time HH:MM
function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [d, m, y] = dateStr.split('/');
  if (!d || !m || !y) return null;
  const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  const t = timeStr ? timeStr.trim().padStart(5,'0') : '00:00';
  const ts = new Date(`${iso}T${t}:00`);
  return isNaN(ts.getTime()) ? null : ts.toISOString();
}

// ── Deterministic UUID (v4-shaped, from SHA-256 of key fields) ───────────────
// appointments.id is UUID type; financial_settlements.id is VARCHAR(64)
function makeUUID(str) {
  const h = crypto.createHash('sha256').update(str).digest('hex');
  // Format: 8-4-4-4-12, set version=4 nibble and variant bits
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

// Shorter hex ID for financial_settlements (VARCHAR(64))
function makeHexId(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

// ── Status → appointment_status enum ─────────────────────────────────────────
// Valid values: scheduled | confirmed | showed | no_show | cancelled
function mapStatus(estado, confirmada) {
  const e = estado.toLowerCase();
  if (e.includes('cancelad') || e.includes('anulaad')) return 'cancelled';
  if (e.includes('no asisti') || e.includes('no show') || e.includes('falta')) return 'no_show';
  if (e.includes('realizada') || e.includes('asistió') || e.includes('asistio')) return 'showed';
  if (e.includes('confirm') || (confirmada && confirmada.toLowerCase().startsWith('sí'))) return 'confirmed';
  return 'scheduled';
}

// ── Amount parsing ────────────────────────────────────────────────────────────
function parseAmount(raw) {
  if (!raw) return null;
  // Remove currency symbols, spaces; replace comma decimal separator
  const cleaned = raw.replace(/[€$\s]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Load service account
  const serviceAccount = loadServiceAccount(SA_FILE);

  // Authenticate
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  console.log(`Reading sheet ${SHEET_ID} range ${RANGE}…`);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: RANGE,
  });

  const rows = response.data.values || [];
  if (rows.length < 2) {
    console.log('Sheet is empty or has only headers. Nothing to ingest.');
    return;
  }

  const [headerRow, ...dataRows] = rows;
  const colMap = buildColMap(headerRow);
  console.log('Column map:', colMap);

  // Validate required columns exist
  const required = ['fecha', 'asunto'];
  const missing = required.filter(f => colMap[f] === undefined);
  if (missing.length) {
    console.error(`Missing required columns: ${missing.join(', ')}`);
    console.error('Found headers:', headerRow);
    process.exit(1);
  }

  // Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const settlementRows = [];
  const appointmentRows = [];
  let skipped = 0;

  for (const row of dataRows) {
    if (!row.length) continue;

    const estado      = get(row, colMap, 'estado');
    const fecha       = get(row, colMap, 'fecha');
    const hora        = get(row, colMap, 'hora');
    const fechaCrea   = get(row, colMap, 'fecha_creacion');
    const horaCrea    = get(row, colMap, 'hora_creacion');
    const asunto      = get(row, colMap, 'asunto');
    const agenda      = get(row, colMap, 'agenda');
    const salaBox     = get(row, colMap, 'sala_box');
    const confirmada  = get(row, colMap, 'confirmada');
    const procedencia = get(row, colMap, 'procedencia');
    const importe     = get(row, colMap, 'importe');

    if (!fecha && !asunto) { skipped++; continue; }

    const keyStr    = [fecha, hora, asunto, agenda].join('|').toLowerCase();
    const apptUUID  = makeUUID(keyStr);
    const settlHex  = makeHexId(keyStr);

    const startTime  = parseDateTime(fecha, hora);
    const createdAt  = parseDateTime(fechaCrea, horaCrea);
    const amount     = parseAmount(importe);
    const status     = mapStatus(estado, confirmada);
    const cancelled  = status === 'cancelled';
    const noShow     = status === 'no_show';
    const confirmed  = status === 'confirmed' || status === 'showed';

    const nowIso = new Date().toISOString();

    // ── appointments upsert ───────────────────────────────────────────────
    // Only include columns that exist in schema; omit doctor_id/treatment_type_id
    // (no FK lookup by name at this stage).
    appointmentRows.push({
      id:           apptUUID,
      clinic_id:    CLINIC_ID,
      start_time:   startTime,
      status,
      notes:        [asunto, agenda, salaBox, procedencia].filter(Boolean).join(' | ') || null,
      cancelled_at: cancelled ? (startTime || nowIso) : null,
      no_show_at:   noShow    ? (startTime || nowIso) : null,
      confirmed_at: confirmed ? (startTime || nowIso) : null,
    });

    // ── financial_settlements upsert — only rows with a positive amount ───
    if (amount && amount > 0 && !cancelled) {
      settlementRows.push({
        id:                settlHex,
        clinic_id:         CLINIC_ID,
        amount_gross:      amount,
        amount_discount:   0,
        amount_net:        amount,
        payment_method:    procedencia || null,
        template_name:     asunto || null,
        intermediary_name: agenda || null,
        settled_at:        startTime || nowIso,
        intake_at:         createdAt || null,
        source_system:     'doctoralia',
        cancelled_at:      null,
      });
    }
  }

  console.log(`Parsed: ${appointmentRows.length} appointments, ${settlementRows.length} settlements, ${skipped} skipped.`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: first 3 appointments ---');
    console.log(JSON.stringify(appointmentRows.slice(0, 3), null, 2));
    console.log('\n--- DRY RUN: first 3 settlements ---');
    console.log(JSON.stringify(settlementRows.slice(0, 3), null, 2));
    return;
  }

  // ── Upsert appointments ────────────────────────────────────────────────────
  if (appointmentRows.length) {
    const { error: apptErr } = await supabase
      .from('appointments')
      .upsert(appointmentRows, { onConflict: 'id', ignoreDuplicates: false });
    if (apptErr) console.error('Appointments upsert error:', apptErr.message);
    else console.log(`✓ Upserted ${appointmentRows.length} appointments.`);
  }

  // ── Upsert settlements ─────────────────────────────────────────────────────
  if (settlementRows.length) {
    const { error: settErr } = await supabase
      .from('financial_settlements')
      .upsert(settlementRows, { onConflict: 'id', ignoreDuplicates: false });
    if (settErr) console.error('Settlements upsert error:', settErr.message);
    else console.log(`✓ Upserted ${settlementRows.length} financial settlements.`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
