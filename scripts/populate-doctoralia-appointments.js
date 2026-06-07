#!/usr/bin/env node
'use strict';

/**
 * Loads the Doctoralia appointment export from a local Excel workbook into
 * public.doctoralia_appointments_ingestion.
 *
 * Required env vars (.env.local is loaded automatically):
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY
 *
 * Optional env vars:
 *   DOCTORALIA_APPOINTMENTS_XLSX_PATH (default: ./Base Pacientes Nuvanx.xlsx)
 *   DOCTORALIA_APPOINTMENTS_SHEET_NAME (default: Doctoralia)
 *   DOCTORALIA_APPOINTMENTS_CHUNK_SIZE (default: 500)
 *
 * Flags:
 *   --dry-run  Parse and summarize the workbook without writing to Supabase.
 */

const fs = require('node:fs');
const path = require('node:path');
const XlsxPopulate = require('xlsx-populate');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config({ path: '.env.local' });

const DEFAULT_WORKBOOK = 'Base Pacientes Nuvanx.xlsx';
const DEFAULT_SHEET = 'Doctoralia';
const DEFAULT_CHUNK_SIZE = 500;
const DRY_RUN = process.argv.includes('--dry-run');

const WORKBOOK_PATH = path.resolve(
  process.cwd(),
  process.env.DOCTORALIA_APPOINTMENTS_XLSX_PATH || DEFAULT_WORKBOOK,
);
const SHEET_NAME = process.env.DOCTORALIA_APPOINTMENTS_SHEET_NAME || DEFAULT_SHEET;
const CHUNK_SIZE = parsePositiveInt(process.env.DOCTORALIA_APPOINTMENTS_CHUNK_SIZE, DEFAULT_CHUNK_SIZE);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

const HEADER_ALIASES = {
  estado: ['estado', 'status'],
  appointment_date: ['fecha', 'fecha cita', 'appointment date'],
  appointment_time: ['hora', 'hora cita', 'appointment time'],
  created_date: ['fecha creacion', 'fecha creación', 'created date'],
  created_time: ['hora creacion', 'hora creación', 'created time'],
  subject: ['asunto', 'subject'],
  agenda: ['agenda', 'calendario', 'doctor'],
  room: ['sala', 'box', 'room'],
  confirmed: ['confirmado', 'confirmed'],
  origin: ['origen', 'origin', 'canal'],
  amount: ['importe', 'amount', 'precio'],
  normalized_date: ['fecha normalizada', 'normalized date'],
  doctoralia_id: ['id', 'doctoralia id', 'id doctoralia'],
  patient_name: ['nombre', 'paciente', 'patient name'],
  phone: ['telefono', 'teléfono', 'phone', 'movil', 'móvil'],
  treatment: ['tratamiento', 'treatment'],
  day_num: ['dia', 'día', 'day'],
  month_num: ['mes', 'month'],
  year_num: ['ano', 'año', 'year'],
  clinic: ['clinica', 'clínica', 'clinic'],
};

const REQUIRED_HEADERS = [
  'estado',
  'appointment_date',
  'appointment_time',
  'subject',
  'agenda',
  'amount',
  'doctoralia_id',
  'patient_name',
  'phone',
  'treatment',
  'clinic',
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

function hasAny(value, tokens) {
  const text = String(value || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

function isBlankRow(row) {
  return row.every((cell) => clean(cell) === null);
}

function buildRecord(row, headerMap, sheetRow) {
  const estado = clean(getCell(row, headerMap, 'estado'));
  const agenda = clean(getCell(row, headerMap, 'agenda'));
  const treatment = clean(getCell(row, headerMap, 'treatment'));

  return {
    sheet_row: sheetRow,
    estado,
    appointment_date: parseDate(getCell(row, headerMap, 'appointment_date')),
    appointment_time: clean(getCell(row, headerMap, 'appointment_time')),
    created_date: parseDate(getCell(row, headerMap, 'created_date')),
    created_time: clean(getCell(row, headerMap, 'created_time')),
    subject: clean(getCell(row, headerMap, 'subject')),
    agenda,
    room: clean(getCell(row, headerMap, 'room')),
    confirmed: clean(getCell(row, headerMap, 'confirmed')),
    origin: clean(getCell(row, headerMap, 'origin')),
    amount: parseAmount(getCell(row, headerMap, 'amount')),
    normalized_date: parseDate(getCell(row, headerMap, 'normalized_date')),
    doctoralia_id: clean(getCell(row, headerMap, 'doctoralia_id')),
    patient_name: clean(getCell(row, headerMap, 'patient_name')),
    phone: clean(getCell(row, headerMap, 'phone')),
    phone_normalized: normalizePhone(getCell(row, headerMap, 'phone')),
    treatment,
    day_num: parseIntOrNull(getCell(row, headerMap, 'day_num')),
    month_num: parseIntOrNull(getCell(row, headerMap, 'month_num')),
    year_num: parseIntOrNull(getCell(row, headerMap, 'year_num')),
    clinic: clean(getCell(row, headerMap, 'clinic')),
    is_cancelled: hasAny(estado, ['ANULAD', 'CANCEL', 'BAJA']),
    is_jjrt: hasAny(agenda, ['JJRT', 'MEDICINA EST']),
    is_nursing: hasAny(agenda, ['ENFERMER', 'DERMOCOSM']),
    is_control: hasAny(treatment, ['REVISION', 'CONTROL', 'REPASO']),
    raw_data: {
      source: path.basename(WORKBOOK_PATH),
      sheet: SHEET_NAME,
      row: sheetRow,
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
    withPhone: records.filter((record) => record.phone_normalized).length,
  };
}

async function readRecords() {
  if (!fs.existsSync(WORKBOOK_PATH)) {
    throw new Error(`Workbook not found: ${WORKBOOK_PATH}`);
  }

  const workbook = await XlsxPopulate.fromFileAsync(WORKBOOK_PATH);
  const sheet = workbook.sheet(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const usedRange = sheet.usedRange();
  if (!usedRange) return [];

  const rows = usedRange.value();
  if (!rows || rows.length < 2) return [];

  const headerMap = buildHeaderMap(rows[0]);
  ensureRequiredHeaders(headerMap);

  return rows
    .slice(1)
    .map((row, index) => (isBlankRow(row) ? null : buildRecord(row, headerMap, index + 2)))
    .filter(Boolean);
}

async function upsertRecords(records) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error('Missing SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY in .env.local');
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (let index = 0; index < records.length; index += CHUNK_SIZE) {
    const chunk = records.slice(index, index + CHUNK_SIZE);
    const { error } = await supabase
      .from('doctoralia_appointments_ingestion')
      .upsert(chunk, { onConflict: 'sheet_row' });

    if (error) throw error;
    console.log(`[doctoralia-appointments] Upserted ${index + chunk.length}/${records.length}`);
  }
}

async function main() {
  const records = await readRecords();
  const totals = summarize(records);

  console.log(`[doctoralia-appointments] Parsed ${records.length} rows from ${WORKBOOK_PATH} (${SHEET_NAME}).`);
  console.table(totals);

  if (DRY_RUN) {
    console.log('[doctoralia-appointments] Dry run completed; no rows were written.');
    return;
  }

  await upsertRecords(records);
  console.log('[doctoralia-appointments] Load completed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[doctoralia-appointments] Load failed.');
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildHeaderMap,
  buildRecord,
  clean,
  hasAny,
  normalizePhone,
  parseAmount,
  parseDate,
  summarize,
};
