#!/usr/bin/env node
/**
 * ingest-doctoralia.js
 * Downloads the Doctoralia xlsm file from Google Drive, parses it, and
 * upserts the appointment rows into Supabase.
 *
 * TABLES WRITTEN:
 *   doctoralia_raw       — immutable audit log (raw_hash dedup)
 *   appointments         — deduplicated appointment events
 *   doctoralia_patients  — one row per Doctoralia patient_id
 *
 * IDENTITY DATA SOURCE (Asunto field):
 *   Format: "<id>. <FULL NAME> [<phone>] (<treatment>)"
 *   All identity fields (patient_id, name, phone, treatment) are parsed
 *   from this compound field. There is no standalone name/DNI/phone column.
 *
 * REVENUE CLASSIFICATION:
 *   Realizada  → attended, confirmed revenue
 *   Pendiente  → booked, pipeline (NOT yet collected)
 *   Pagada     → all have Importe=0 (free/processed visits)
 *   Anulada    → cancelled
 *   No Acude   → no-show
 *
 * REQUIRED ENV:
 *   DOCTORALIA_DRIVE_FILE_ID    — Google Drive file ID
 *   DOCTORALIA_SHEET_ID         — Alias for DOCTORALIA_DRIVE_FILE_ID
 *   CLINIC_ID                   — Supabase clinic UUID
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * OPTIONAL:
 *   DRY_RUN=1     — preview without writing to DB
 *   SHEET_NAME    — sheet tab name (default: "Produccion Intermediarios")
 *   GOOGLE_SA_JSON — service account JSON string (overrides file)
 *   GOOGLE_SERVICE_ACCOUNT_FILE — path to SA JSON file
 *
 * USAGE:
 *   DOCTORALIA_DRIVE_FILE_ID=1Y2sC3KDZOdnCYWxEeuAQ0DmTdXR-vSIR \
 *   CLINIC_ID=4207023b-eac1-4249-bf0f-d9b1e36a5d7a \
 *   SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   DRY_RUN=1 \
 *   node scripts/ingest-doctoralia.js
 */

'use strict';

const path   = require('node:path');
const fs     = require('node:fs');
const crypto = require('node:crypto');
const os     = require('node:os');

// Load .env from repo root only when explicitly allowed (local dev).
// In CI/production, prefer repository secrets and avoid loading .env files.
const dotenvPath = path.join(__dirname, '..', '.env');
if (process.env.LOAD_LOCAL_DOTENV === '1' && fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const { google }       = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const XlsxPopulate = require('xlsx-populate');

function normalizeCellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.text) return value.text;
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if (value.result !== undefined) return String(value.result);
    return String(value);
  }
  return value;
}

// ── Config ───────────────────────────────────────────────────────────────────
const FILE_ID    = process.env.DOCTORALIA_DRIVE_FILE_ID || process.env.DOCTORALIA_SHEET_ID || process.argv[2];
const SHEET_NAME = process.env.SHEET_NAME || 'Produccion Intermediarios';
const DRY_RUN    = process.env.DRY_RUN === '1';
const { CLINIC_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY } = process.env;

const miss = [
  !FILE_ID    && 'DOCTORALIA_DRIVE_FILE_ID or DOCTORALIA_SHEET_ID',
  !CLINIC_ID  && 'CLINIC_ID',
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);
if (miss.length) { console.error('Missing env vars:', miss.join(', ')); process.exit(1); }
// Avoid printing the actual service role key; confirm only presence.
if (SUPABASE_KEY) {
  console.log('[REDACTED]');
}

// ── Service account loader ───────────────────────────────────────────────────
function loadSA() {
  const raw = process.env.GOOGLE_SA_JSON;
  if (raw) return JSON.parse(raw);
  const f = process.env.GOOGLE_SERVICE_ACCOUNT_FILE
    || path.join(__dirname, '..', 'backend', 'google-service-account.json');
  if (!fs.existsSync(f)) throw new Error(`Service account file not found: ${f}`);
  const content = fs.readFileSync(f, 'utf8');
  // Handle files with env vars appended after the JSON object
  let d = 0, e = -1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') d++;
    else if (content[i] === '}') { d--; if (d === 0) { e = i; break; } }
  }
  return JSON.parse(content.slice(0, e + 1));
}

// ── Name normalization ───────────────────────────────────────────────────────
function normName(s) {
  if (!s) return '';
  return s.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '').toLowerCase().replaceAll(/\s+/g, ' ').trim();
}

// ── Phone normalization (ES format) ─────────────────────────────────────────
function normPhone(s) {
  if (!s) return null;
  const d = s.replaceAll(/\D/g, '');
  if (d.length === 9 && /^[6789]/.test(d)) return d;
  if (d.length === 11 && d.startsWith('34')) return d.slice(2);
  if (d.length === 12 && d.startsWith('034')) return d.slice(3);
  return d.length >= 9 ? d.slice(-9) : null;
}

// ── Asunto parser ────────────────────────────────────────────────────────────
// Format: "<id>. <FULL NAME> [<phone1> - <phone2>] (<treatment>)"
const ASUNTO_RE = /^(\d+)\.\s+(.+?)\s+\[([^\]]*)\]\s+\((.+?)\)\s*$/;
const PHONE_RE  = /\d{9}/g;

function parseAsunto(raw) {
  if (!raw) return null;
  const m = ASUNTO_RE.exec(raw.toString().trim());
  if (!m) return null;
  const [, docId, name, pRaw, treatment] = m;
  const phones = (pRaw.match(PHONE_RE) || []).map(normPhone).filter(Boolean);
  return { doc_patient_id: docId, full_name: name.trim(), name_norm: normName(name), phones, treatment: treatment.trim() };
}

// ── Status mapping ───────────────────────────────────────────────────────────
function mapStatus(e) {
  const s = (e || '').toLowerCase();
  if (s.includes('anulad')) return 'cancelled';
  if (s === 'no acude' || s.includes('no acude')) return 'no_show';
  if (s === 'realizada') return 'showed';
  if (s === 'pagada') return 'confirmed';
  return 'scheduled';
}

// ── Deterministic IDs ────────────────────────────────────────────────────────
function deterministicUUID(str) {
  const h = crypto.createHash('sha256').update(str).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((Number.parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}
function hex32(str) { return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32); }

// ── Main Helpers ─────────────────────────────────────────────────────────────

async function downloadDriveFile(drive, fileId, destPath) {
  console.log(`Downloading Drive file ${fileId} → ${destPath}`);
  return new Promise((res, rej) => {
    drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' }, (err, r) => {
      if (err) return rej(err);
      const ws = fs.createWriteStream(destPath);
      r.data.pipe(ws);
      ws.on('finish', res);
      ws.on('error', rej);
    });
  });
}

function buildHeaderMap(headerRow) {
  const COL = {};
  headerRow.forEach((h, i) => {
    const k = (h || '').toString().trim()
      .normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '')
      .toLowerCase().replaceAll(/\s+/g, '_').replaceAll(/[^a-z0-9_/]/g, '');
    COL[k] = i;
  });
  return COL;
}

function formatISO(date, time) {
  if (!date) return null;
  return time ? `${date}T${time}:00` : `${date}T00:00:00`;
}

function processRow(row, COL, uploadId, ingestedAt, sn) {
  const get = (key) => (row[COL[key]] || '').toString().trim();

  const estado      = get('estado');
  const fecha       = get('fecha');
  const hora        = get('hora');
  const fechaCrea   = get('fecha_creacion');
  const horaCrea    = get('hora_creacion');
  const asuntoRaw   = get('asunto');
  const agenda      = get('agenda');
  const salaBox     = get('sala/box');
  const confirmada  = get('confirmada');
  const procedencia = get('procedencia');
  const importeRaw  = get('importe');

  if (!asuntoRaw && !fecha) return null;

  const parsed   = parseAsunto(asuntoRaw);
  const rawImporte = Number.parseFloat(importeRaw.replaceAll(',', '.')) || 0;
  const importe = Number.isNaN(rawImporte) ? 0 : rawImporte;
  const status   = mapStatus(estado);
  const horaStart = hora ? hora.split('-')[0].trim() : null;
  const startISO  = formatISO(fecha, horaStart);
  const creaISO   = formatISO(fechaCrea, horaCrea);
  const idKey     = [fecha, hora, (asuntoRaw || '').slice(0, 80)].join('|');
  const rawHash   = hex32(idKey);

  const rawIngest = {
    raw_hash:          rawHash,
    clinic_id:         CLINIC_ID,
    upload_id:         uploadId,
    raw_row:           {},
    ingested_at:       ingestedAt,
    source_file_id:    FILE_ID,
    sheet_name:        sn,
    estado,
    fecha:             fecha || null,
    hora:              hora || null,
    fecha_creacion:    fechaCrea || null,
    hora_creacion:     horaCrea || null,
    asunto:            asuntoRaw || null,
    agenda:            agenda || null,
    sala_box:          salaBox || null,
    confirmada:        confirmada === 'Sí' || confirmada === 'Si',
    procedencia:       procedencia === '-' ? null : procedencia || null,
    importe,
    doc_patient_id:    parsed?.doc_patient_id || null,
    patient_name:      parsed?.full_name || null,
    patient_name_norm: parsed?.name_norm || null,
    phone_primary:     parsed?.phones?.[0] || null,
    phone_secondary:   parsed?.phones?.[1] || null,
    treatment:         parsed?.treatment || null,
    appointment_start: startISO,
    created_record_at: creaISO,
  };

  const cancelled = status === 'cancelled', noShow = status === 'no_show';
  const confirmed = status === 'confirmed' || status === 'showed';
  const apptRow = {
    id:           deterministicUUID(idKey),
    clinic_id:    CLINIC_ID,
    start_time:   startISO,
    status,
    notes:        [parsed?.treatment, agenda, salaBox, procedencia === '-' ? null : procedencia].filter(Boolean).join(' | ') || null,
    cancelled_at: cancelled ? startISO : null,
    no_show_at:   noShow ? startISO : null,
    confirmed_at: confirmed ? startISO : null,
  };

  let patientRow = null;
  if (parsed?.doc_patient_id) {
    patientRow = {
      doc_patient_id:  parsed.doc_patient_id,
      clinic_id:       CLINIC_ID,
      full_name:       parsed.full_name,
      name_norm:       parsed.name_norm,
      phone_primary:   parsed.phones?.[0] || null,
      phone_secondary: parsed.phones?.[1] || null,
      first_seen_at:   startISO,
      lead_id:         null,
      match_confidence: null,
      match_class:     null,
    };
  }

  return { rawIngest, apptRow, patientRow };
}

// ── Main ─────────────────────────────────────────────────────────────────────
// ── Main ─────────────────────────────────────────────────────────────────────
function getDriveClient() {
  const sa   = loadSA();
  const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  return google.drive({ version: 'v3', auth });
}

async function loadWorkbookData(drive, tmpPath) {
  await downloadDriveFile(drive, FILE_ID, tmpPath);
  try {
    const workbook = await XlsxPopulate.fromFileAsync(tmpPath);
    const sheet = workbook.sheet(SHEET_NAME) || workbook.sheets()[0];
    if (!sheet) return null;

    const range = sheet.usedRange();
    const rawRows = (range ? range.value() : []).map(row => (row || []).map(cell => normalizeCellValue(cell ?? null)));
    return { sn: sheet.name(), rawRows };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (cleanupError) {
      console.warn('[ingest-doctoralia] Could not remove temp file:', cleanupError?.message || cleanupError);
    }
  }
}

function processAllRows(rawRows, sn) {
  const COL = buildHeaderMap(rawRows[0] || []);
  const uploadId    = crypto.randomUUID();
  const ingestedAt  = new Date().toISOString();
  const rawIngests  = [], apptRows = [], patientMap = {};
  let skipped = 0;

  for (const row of rawRows.slice(1)) {
    if (!row || row.every(c => c === null)) { skipped++; continue; }
    const result = processRow(row, COL, uploadId, ingestedAt, sn);
    if (!result) { skipped++; continue; }

    rawIngests.push(result.rawIngest);
    apptRows.push(result.apptRow);
    if (result.patientRow && !patientMap[result.patientRow.doc_patient_id]) {
      patientMap[result.patientRow.doc_patient_id] = result.patientRow;
    }
  }
  return { rawIngests, apptRows, patientRows: Object.values(patientMap), skipped };
}

async function uploadToSupabase(rawIngests, apptRows, patientRows) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const BATCH = 200;

  for (let i = 0; i < rawIngests.length; i += BATCH) {
    const { error } = await supabase.from('doctoralia_raw').upsert(rawIngests.slice(i, i+BATCH), { onConflict: 'raw_hash' });
    if (error) { console.error('doctoralia_raw:', error.message); break; }
  }
  console.log(`✓ ${rawIngests.length} → doctoralia_raw`);

  for (let i = 0; i < apptRows.length; i += BATCH) {
    const { error } = await supabase.from('appointments').upsert(apptRows.slice(i, i+BATCH), { onConflict: 'id' });
    if (error) { console.error('appointments:', error.message); break; }
  }
  console.log(`✓ ${apptRows.length} → appointments`);

  if (patientRows.length) {
    const { error } = await supabase.from('doctoralia_patients').upsert(patientRows, { onConflict: 'doc_patient_id,clinic_id', ignoreDuplicates: true });
    if (error) console.error('doctoralia_patients:', error.message);
    else console.log(`✓ ${patientRows.length} → doctoralia_patients`);
  }
}

async function main() {
  const drive = getDriveClient();
  const tmp = path.join(os.tmpdir(), `doctoralia_${Date.now()}.xlsx`);

  const data = await loadWorkbookData(drive, tmp);
  if (!data) { console.log('No sheet found.'); return; }
  const { sn, rawRows } = data;
  if (rawRows.length < 2) { console.log('Empty sheet.'); return; }

  const { rawIngests, apptRows, patientRows, skipped } = processAllRows(rawRows, sn);
  const finRows = rawIngests.filter(r => r.importe > 0);

  console.log(`Sheet: "${sn}"`);
  console.log(`\nParsed: ${rawIngests.length} raw | ${apptRows.length} appointments | ${patientRows.length} patients | ${skipped} skipped`);
  console.log(`Revenue: confirmed €${finRows.filter(r => r.estado === 'Realizada').reduce((s,r) => s+r.importe, 0).toFixed(2)} | pipeline €${finRows.filter(r => r.estado === 'Pendiente').reduce((s,r) => s+r.importe, 0).toFixed(2)} | cancelled €${finRows.filter(r => r.estado === 'Anulada').reduce((s,r) => s+r.importe, 0).toFixed(2)}`);

  if (DRY_RUN) {
    console.log('\n── DRY RUN: 2 raw rows ──');
    console.log(JSON.stringify(rawIngests.slice(0, 2), null, 2));
    console.log('\n── DRY RUN: 2 patients ──');
    console.log(JSON.stringify(patientRows.slice(0, 2), null, 2));
    return;
  }

  await uploadToSupabase(rawIngests, apptRows, patientRows);

  try { fs.unlinkSync(tmp); } catch (err) { console.warn(`Could not remove temp file ${tmp}:`, err.message); }
  console.log('\nDone. Run: SELECT run_doctoralia_name_match() to link patients → leads.');
}

main().catch(e => { console.error('Fatal:', e.message || e); process.exit(1); });

