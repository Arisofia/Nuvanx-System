#!/usr/bin/env node
'use strict';

/**
 * Read-only parser for Doctoralia appointment exports.
 *
 * This module intentionally has no Supabase client and no persistence path.
 * Production writes belong exclusively to scripts/sync-doctoralia-appointments.js,
 * which canonicalizes appointment identity and applies incremental deltas.
 */

const fs = require('node:fs');
const path = require('node:path');
const XlsxPopulate = require('xlsx-populate');

require('dotenv').config({ path: '.env.local' });

const DEFAULT_CSV = 'doctoralia_appointments.csv';
const DEFAULT_WORKBOOK = 'Base Pacientes Nuvanx.xlsx';
const DEFAULT_SHEET = 'Base Completa Doctoralia';
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
  doctoralia_id: ['id', 'doctoralia id', 'id doctoralia', 'nº historia', 'n historia', 'numero historia', 'número historia', 'historia', 'codigo cliente', 'código cliente'],
  patient_name: ['nombre', 'paciente', 'patient name', 'patient_name'],
  patient_email: ['email', 'correo', 'patient email', 'patient_email'],
  phone: ['telefono', 'teléfono', 'phone', 'movil', 'móvil', 'patient phone', 'patient_phone'],
  treatment: ['tratamiento', 'concepto cita', 'concepto', 'treatment', 'appointment type', 'appointment_type'],
  notes: ['notas', 'notes', 'observaciones'],
  day_num: ['dia', 'día', 'day'],
  month_num: ['mes', 'month'],
  year_num: ['ano', 'año', 'year'],
  clinic: ['clinica', 'clínica', 'clinic'],
};

const REQUIRED_HEADERS = ['estado', 'appointment_date', 'doctoralia_id', 'patient_name'];

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

function findHeaderRowIndex(rows) {
  if (!Array.isArray(rows)) return -1;
  return rows.findIndex((row) => {
    if (!Array.isArray(row)) return false;
    const headerMap = buildHeaderMap(row);
    return REQUIRED_HEADERS.every((field) => headerMap[field] !== undefined);
  });
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

// Parser-local lineage key only. It is never the persisted appointment identity;
// sync-doctoralia-appointments canonicalizes every record to doctoralia_appt_v3.
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
  const sourceKey = buildAppointmentSourceKey({ sheetRow, appointmentDate, appointmentTime, doctoraliaId, phone, treatment });
  const controlText = `${patientName || ''} ${clean(getCell(row, headerMap, 'subject')) || ''} ${treatment || ''}`;

  return {
    source_key: sourceKey,
    appointment_id: sourceKey,
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
    clinic: (() => {
      const explicit = clean(getCell(row, headerMap, 'clinic'));
      if (explicit && (explicit.includes('Chamber') || explicit.includes('Goya') || explicit.includes('Salamanca'))) return explicit;
      const isChamberi = hasAny(agenda, ['JJRT', 'MEDICINA EST', 'ENFERMER', 'DERMOCOSM']);
      return isChamberi ? 'Centro Clínico NUVANX Chamberí' : 'Centro Clínico NUVANX Salamanca–Goya';
    })(),
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

function recordsFromRows(rows) {
  if (!rows || rows.length < 2) return [];
  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) throw new Error('Missing Doctoralia header row');
  const headerMap = buildHeaderMap(rows[headerRowIndex]);
  ensureRequiredHeaders(headerMap);
  return rows
    .slice(headerRowIndex + 1)
    .map((row, index) => (isBlankRow(row) ? null : buildRecord(row, headerMap, index + headerRowIndex + 2)))
    .filter(Boolean);
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
    throw new Error('Invalid Doctoralia appointment records before upsert: every row must include source_key, appointment_id and integer sheet_row.');
  }
}

function dedupeRecordsBySourceKey(records) {
  validateRecordsForUpsert(records);
  const dedupedMap = new Map();
  for (const record of records) dedupedMap.set(record.source_key, record);
  return Array.from(dedupedMap.values());
}

async function readRowsFromCsv() {
  return parseCsv(fs.readFileSync(INPUT_PATH, 'utf8').replace(/^\uFEFF/, ''));
}

async function readRowsFromWorkbook() {
  const workbook = await XlsxPopulate.fromFileAsync(INPUT_PATH);
  const sheet = workbook.sheet(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet not found: ${SHEET_NAME}`);
  const usedRange = sheet.usedRange();
  return usedRange ? (usedRange.value() || []) : [];
}

async function readRecords() {
  if (!fs.existsSync(INPUT_PATH)) throw new Error(`Doctoralia appointments input not found: ${INPUT_PATH}`);
  const rows = INPUT_EXT === '.csv' ? await readRowsFromCsv() : await readRowsFromWorkbook();
  return recordsFromRows(rows);
}

async function main() {
  if (!DRY_RUN) {
    throw new Error('Direct Doctoralia parser writes are disabled. Use scripts/sync-doctoralia-appointments.js for canonical incremental persistence.');
  }
  const records = await readRecords();
  console.log(`[doctoralia-appointments] Parsed ${records.length} rows from input file (read-only).`);
  console.table(summarize(records));
  console.log('[doctoralia-appointments] Dry run completed; no rows were written.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[doctoralia-appointments] Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = {
  buildAppointmentSourceKey,
  buildHeaderMap,
  parseCsv,
  buildRecord,
  dedupeRecordsBySourceKey,
  ensureRequiredHeaders,
  recordsFromRows,
  readRecords,
  validateRecordsForUpsert,
  clean,
  hasAny,
  normalizePhone,
  parseAmount,
  parseDate,
  summarize,
  findHeaderRowIndex,
};
