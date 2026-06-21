#!/usr/bin/env node
'use strict';

/**
 * Loads Doctoralia appointment exports from a local CSV or Excel workbook into
 * public.doctoralia_appointments_ingestion.
 *
 * Daily sync rules:
 *   - Doctoralia ID is a patient/client code, NOT an appointment identifier.
 *   - source_key and appointment_id must be appointment-level keys so repeated
 *     visits for the same Doctoralia patient are preserved.
 *   - Operational views classify visits as:
 *       1ra cita   = first real appointment for the patient
 *       nuevo      = second real appointment for the patient
 *       recurrente = third and later real appointments
 *       churn_90d  = no later appointment within 90 days of a month-end visit
 *   - Revisión/Revisión tratamiento is a real appointment type and must not be
 *     treated as an internal control by default.
 *
 * Required env vars (.env.local is loaded automatically):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY
 *
 * Optional env vars:
 *   DOCTORALIA_APPOINTMENTS_INPUT_PATH (default: ./doctoralia_appointments.csv when present, otherwise ./Base Pacientes Nuvanx.xlsx)
 *   DOCTORALIA_APPOINTMENTS_XLSX_PATH (legacy alias for Excel-only runs)
 *   DOCTORALIA_APPOINTMENTS_SHEET_NAME (default: Doctoralia; Excel only)
 *   DOCTORALIA_APPOINTMENTS_CHUNK_SIZE (default: 500)
 *   DOCTORALIA_APPOINTMENTS_REPLACE_MODE (default: true; replace table contents before load)
 *
 * Flags:
 *   --dry-run  Parse and summarize the input file without writing to Supabase.
 */

const fs = require('node:fs');
const path = require('node:path');
const XlsxPopulate = require('xlsx-populate');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: '.env.local' });

const DEFAULT_CSV = 'doctoralia_appointments.csv';
const DEFAULT_WORKBOOK = 'Base Pacientes Nuvanx.xlsx';
const DEFAULT_SHEET = 'Doctoralia';
const DEFAULT_CHUNK_SIZE = 500;
const DRY_RUN = process.argv.includes('--dry-run');

const INPUT_PATH = path.resolve(
  process.cwd(),
  process.env.DOCTORALIA_APPOINTMENTS_INPUT_PATH ||
    process.env.DOCTORALIA_APPOINTMENTS_CSV_PATH ||
    process.env.DOCTORALIA_APPOINTMENTS_XLSX_PATH ||
    (fs.existsSync(path.resolve(process.cwd(), DEFAULT_CSV)) ? DEFAULT_CSV : DEFAULT_WORKBOOK),
);
const INPUT_EXT = path.extname(INPUT_PATH).toLowerCase();
const SHEET_NAME = process.env.DOCTORALIA_APPOINTMENTS_SHEET_NAME || DEFAULT_SHEET;
const CHUNK_SIZE = parsePositiveInt(process.env.DOCTORALIA_APPOINTMENTS_CHUNK_SIZE, DEFAULT_CHUNK_SIZE);
const REPLACE_MODE = String(process.env.DOCTORALIA_APPOINTMENTS_REPLACE_MODE || 'true').toLowerCase() !== 'false';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const HEADER_ALIASES = {
  estado: ['estado', 'status'],
  appointment_date: ['fecha', 'fecha cita', 'appointment date', 'appointment_date'],
  appointment_time: ['hora', 'hora cita', 'appointment time'],
  created_date: ['fecha creacion', 'fecha creación', 'created date'],
  created_time: ['hora creacion', 'hora creación', 'created time'],
  subject: ['asunto', 'subject'],
  agenda: ['agenda', 'calendario', 'doctor'],
  room: ['sala', 'box', 'sala box', 'sala/box', 'room'],
  confirmed: ['confirmada', 'confirmado', 'confirmed'],
  origin: ['procedencia', 'origen', 'origin', 'canal'],
  amount: ['importe', 'amount', 'precio'],
  normalized_date: ['fecha para normalizar', 'fecha normalizada', 'normalized date'],
  doctoralia_id: ['id', 'doctoralia id', 'id doctoralia', 'codigo cliente', 'código cliente'],
  patient_name: ['nombre', 'paciente', 'patient name', 'patient_name'],
  patient_email: ['email', 'correo', 'patient email', 'patient_email'],
  phone: ['telefono', 'teléfono', 'phone', 'movil', 'móvil', 'patient phone', 'patient_phone'],
  treatment: ['tratamiento', 'treatment', 'appointment type', 'appointment_type'],
  notes: ['notas', 'notes', 'observaciones'],
  day_num: ['dia', 'día', 'day'],
  month_num: ['mes', 'month'],
  year_num: ['ano', 'año', 'year'],
  clinic: ['clinica', 'clínica', 'clinic'],
};

const REQUIRED_HEADERS = [
  'estado',
  'appointment_date',
  'doctoralia_id',
  'patient_name',
];

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function dateFromExcelSerial(value) {
  const wholeDays = Math.floor(value);
  const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return dateFromExcelSerial(value);

  const text = String(value).trim();
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function parseAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100) / 100;

  let text = String(value).replace(/[€$\s\u00A0]/g, '');

  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replaceAll('.', '').replaceAll(',', '.')
      : text.replaceAll(',', '');
  } else if (text.includes(',')) {
    text = text.replaceAll(',', '.');
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function parseIntOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhone(value) {
  let phone = String(value || '').replace(/\D+/g, '');
  if (!phone || /^0+$/.test(phone)) return null;
  if (phone.startsWith('0034') && phone.length === 13) phone = phone.slice(4);
  if (phone.startsWith('34') && phone.length === 11) phone = phone.slice(2);
  return phone;
}

function normalizeIdentityText(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hasAny(value, tokens) {
  const text = normalizeIdentityText(value);
  return tokens.some((token) => text.includes(token));
}

function buildHeaderMap(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeHeader);
  const headerMap = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const exactIndex = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
    const partialIndex = exactIndex >= 0
      ? exactIndex
      : normalizedHeaders.findIndex((header) => normalizedAliases.some((alias) => header.includes(alias) || alias.includes(header)));

    if (partialIndex >= 0) headerMap[field] = partialIndex;
  }

  return headerMap;
}

function getCell(row, headerMap, field) {
  const index = headerMap[field];
  return index === undefined ? null : row[index];
}

function ensureRequiredHeaders(headerMap) {
  const missing = REQUIRED_HEADERS.filter((field) => headerMap[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required Doctoralia headers: ${missing.join(', ')}`);
  }
}

function recordsFromRows(rows) {
  if (!rows || rows.length < 2) return [];

  const headerMap = buildHeaderMap(rows[0]);
  ensureRequiredHeaders(headerMap);

  const records = rows
    .slice(1)
    .map((row, index) => (isBlankRow(row) ? null : buildRecord(row, headerMap, index + 2)))
    .filter(Boolean);

  const sourceKeyCount = new Map();
  for (const record of records) {
    sourceKeyCount.set(record.source_key, (sourceKeyCount.get(record.source_key) || 0) + 1);
  }

  const duplicates = Array.from(sourceKeyCount.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  if (duplicates.length > 0) {
    console.warn(
      `[doctoralia-appointments] Found ${duplicates.length} duplicate source_keys. ` +
        `These will be deduplicated during upsert (keeping latest). ` +
        `Sample: ${JSON.stringify(duplicates.slice(0, 5))}`,
    );
  }

  return records;
}

function isBlankRow(row) {
  return row.every((cell) => clean(cell) === null);
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (!isBlankRow(row)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (!isBlankRow(row)) rows.push(row);
  }

  return rows;
}

function buildAppointmentSourceKey({ sheetRow, appointmentDate, appointmentTime, doctoraliaId, phone, treatment }) {
  return [
    'base_pacientes_doctoralia',
    `row=${sheetRow}`,
    `date=${appointmentDate || ''}`,
    `time=${appointmentTime || ''}`,
    `id=${doctoraliaId || ''}`,
    `phone=${normalizePhone(phone) || ''}`,
    `treatment=${treatment || ''}`,
  ].join('|');
}

function buildRecord(row, headerMap, sheetRow) {
  const estado = clean(getCell(row, headerMap, 'estado'));
  const agenda = clean(getCell(row, headerMap, 'agenda'));
  const treatment = clean(getCell(row, headerMap, 'treatment'));
  const doctoraliaId = clean(getCell(row, headerMap, 'doctoralia_id'));
  const appointmentDate = parseDate(getCell(row, headerMap, 'appointment_date'));
  const appointmentTime = clean(getCell(row, headerMap, 'appointment_time'));
  const patientName = clean(getCell(row, headerMap, 'patient_name'));
  const phone = clean(getCell(row, headerMap, 'phone'));
  const sourceKey = buildAppointmentSourceKey({
    sheetRow,
    appointmentDate,
    appointmentTime,
    doctoraliaId,
    phone,
    treatment,
  });
  const controlText = `${patientName || ''} ${clean(getCell(row, headerMap, 'subject')) || ''} ${treatment || ''}`;

  return {
    source_key: sourceKey,
    sheet_row: sheetRow,
    estado,
    status: estado,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime,
    created_date: parseDate(getCell(row, headerMap, 'created_date')),
    created_time: clean(getCell(row, headerMap, 'created_time')),
    subject: clean(getCell(row, headerMap, 'subject')),
    agenda,
    room: clean(getCell(row, headerMap, 'room')),
    confirmed: clean(getCell(row, headerMap, 'confirmed')),
    origin: clean(getCell(row, headerMap, 'origin')),
    amount: parseAmount(getCell(row, headerMap, 'amount')),
    normalized_date: parseDate(getCell(row, headerMap, 'normalized_date')) || appointmentDate,
    doctoralia_id: doctoraliaId,
    appointment_id: sourceKey,
    patient_name: patientName,
    patient_email: clean(getCell(row, headerMap, 'patient_email')),
    phone,
    patient_phone: phone,
    phone_normalized: normalizePhone(phone),
    treatment,
    appointment_type: treatment,
    notes: clean(getCell(row, headerMap, 'notes')),
    day_num: parseIntOrNull(getCell(row, headerMap, 'day_num')),
    month_num: parseIntOrNull(getCell(row, headerMap, 'month_num')),
    year_num: parseIntOrNull(getCell(row, headerMap, 'year_num')),
    clinic: clean(getCell(row, headerMap, 'clinic')),
    is_cancelled: hasAny(estado, ['ANULAD', 'CANCEL', 'BAJA']),
    is_jjrt: hasAny(agenda, ['JJRT', 'MEDICINA EST']),
    is_nursing: hasAny(agenda, ['ENFERMER', 'DERMOCOSM']),
    is_control: hasAny(controlText, ['CAMBIAR', 'PRUEBA', 'TEST', 'MODELO', 'CONTROL']),
    raw_data: {
      source: path.basename(INPUT_PATH),
      sheet: SHEET_NAME,
      row: sheetRow,
      doctoralia_id: doctoraliaId,
      source_key_version: 2,
    },
    updated_at: new Date().toISOString(),
  };
}

function summarize(records) {
  return {
    total: records.length,
    jjrt: records.filter((record) => record.is_jjrt).length,
    nursing: records.filter((record) => record.is_nursing).length,
    paid: records.filter((record) => record.amount > 0).length,
    control: records.filter((record) => record.is_control).length,
    cancelled: records.filter((record) => record.is_cancelled).length,
    withPhone: records.filter((record) => record.phone_normalized).length,
  };
}

function validateRecordsForUpsert(records) {
  const invalid = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => !record.source_key || !Number.isInteger(record.sheet_row) || !record.appointment_id);

  if (invalid.length > 0) {
    const sample = invalid.slice(0, 5).map(({ record, index }) => ({
      index,
      sheet_row: record.sheet_row,
      source_key: record.source_key,
      appointment_id: record.appointment_id,
      doctoralia_id: record.doctoralia_id,
      patient_name: record.patient_name,
    }));
    throw new Error(`Invalid Doctoralia appointment records before upsert: every row must include source_key, appointment_id and integer sheet_row. Sample: ${JSON.stringify(sample)}`);
  }
}

async function readRowsFromCsv() {
  const content = fs.readFileSync(INPUT_PATH, 'utf8').replace(/^\uFEFF/, '');
  return parseCsv(content);
}

async function readRowsFromWorkbook() {
  const workbook = await XlsxPopulate.fromFileAsync(INPUT_PATH);
  const sheet = workbook.sheet(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const usedRange = sheet.usedRange();
  if (!usedRange) return [];

  return usedRange.value() || [];
}

async function readRecords() {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Doctoralia appointments input not found: ${INPUT_PATH}`);
  }

  const rows = INPUT_EXT === '.csv'
    ? await readRowsFromCsv()
    : await readRowsFromWorkbook();

  return recordsFromRows(rows);
}

function getSupabaseClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY in .env.local');
  }

  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function countIngestedRecords() {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from('doctoralia_appointments_ingestion')
    .select('source_key', { count: 'exact', head: true });

  if (error) throw error;
  return count || 0;
}

function dedupeRecordsBySourceKey(records) {
  validateRecordsForUpsert(records);

  const dedupedMap = new Map();

  for (const record of records) {
    dedupedMap.set(record.source_key, record);
  }

  return Array.from(dedupedMap.values());
}

async function replaceIngestionTable(supabase) {
  const { error } = await supabase
    .from('doctoralia_appointments_ingestion')
    .delete()
    .gte('sheet_row', 0);

  if (error) throw new Error(`[doctoralia-appointments] Failed to replace existing ingestion rows: ${error.message}`);
  console.log('[doctoralia-appointments] Existing ingestion rows cleared before full replacement load.');
}

async function upsertRecords(records, options = {}) {
  const supabase = getSupabaseClient();

  const dedupedRecords = dedupeRecordsBySourceKey(records);

  console.log(
    `[doctoralia-appointments] Deduped records by appointment-level source_key: ` +
      `${records.length} → ${dedupedRecords.length}`,
  );

  if (options.replaceMode ?? REPLACE_MODE) {
    await replaceIngestionTable(supabase);
  }

  for (let index = 0; index < dedupedRecords.length; index += CHUNK_SIZE) {
    const chunk = dedupedRecords.slice(index, index + CHUNK_SIZE);

    const { error } = await supabase
      .from('doctoralia_appointments_ingestion')
      .upsert(chunk, { onConflict: 'source_key' });

    if (error) {
      const firstSheetRow = chunk[0]?.sheet_row;
      const lastSheetRow = chunk[chunk.length - 1]?.sheet_row;

      console.error('[doctoralia-appointments] Failed to upsert chunk', {
        error,
        index,
        chunkSize: chunk.length,
        startOffset: index,
        endOffset: index + chunk.length - 1,
        firstSheetRow,
        lastSheetRow,
      });

      const wrappedError = new Error(
        `[doctoralia-appointments] Failed to upsert chunk ` +
          `(index=${index}, size=${chunk.length}, ` +
          `first_sheet_row=${firstSheetRow}, last_sheet_row=${lastSheetRow}): ` +
          error.message,
      );

      wrappedError.cause = error;
      throw wrappedError;
    }

    console.log(
      `[doctoralia-appointments] Upserted ${index + chunk.length}/${dedupedRecords.length} ` +
        `(chunkSize=${chunk.length})`,
    );
  }
}

async function main() {
  const records = await readRecords();
  const totals = summarize(records);

  console.log(
    `[doctoralia-appointments] Parsed ${records.length} rows from input file ` +
      `(type=${INPUT_EXT || 'unknown'}${SHEET_NAME ? ', with sheet' : ''}).`,
  );
  console.table(totals);

  if (DRY_RUN) {
    console.log('[doctoralia-appointments] Dry run completed; no rows were written.');
    return;
  }

  await upsertRecords(records);
  const tableCount = await countIngestedRecords();
  console.log(`[doctoralia-appointments] Load completed. Table now has ${tableCount} rows.`);
}

if (require.main === module) {
  main().catch(() => {
    console.error('[doctoralia-appointments] Load failed.');
    console.error('[doctoralia-appointments] An internal error occurred.');
    process.exit(1);
  });
}

module.exports = {
  buildAppointmentSourceKey,
  buildHeaderMap,
  parseCsv,
  buildRecord,
  countIngestedRecords,
  dedupeRecordsBySourceKey,
  ensureRequiredHeaders,
  getSupabaseClient,
  recordsFromRows,
  readRecords,
  replaceIngestionTable,
  upsertRecords,
  validateRecordsForUpsert,
  clean,
  hasAny,
  normalizePhone,
  parseAmount,
  parseDate,
  summarize,
};
