#!/usr/bin/env node
'use strict';

const { getSupabaseClient } = require('./populate-doctoralia-appointments');

const REQUIRED_COLUMNS = [
  'id',
  'source_key',
  'sheet_row',
  'estado',
  'status',
  'appointment_date',
  'appointment_time',
  'created_date',
  'created_time',
  'subject',
  'agenda',
  'room',
  'confirmed',
  'origin',
  'amount',
  'normalized_date',
  'doctoralia_id',
  'appointment_id',
  'patient_name',
  'patient_email',
  'patient_phone',
  'phone',
  'phone_normalized',
  'treatment',
  'appointment_type',
  'notes',
  'day_num',
  'month_num',
  'year_num',
  'clinic',
  'is_cancelled',
  'is_jjrt',
  'is_nursing',
  'is_control',
  'raw_data',
  'imported_at',
  'updated_at',
];

const LEGACY_IMPORTED_AT_COLUMNS = REQUIRED_COLUMNS.map((column) => (
  column === 'imported_at' ? 'inserted_at' : column
));

function missingColumnError(column) {
  return new RegExp(`(?:column|field)[^\\n]*${column}|${column}[^\\n]*(?:does not exist|not found)`, 'i');
}

async function assertSelectableColumns(supabase, columns) {
  const { error } = await supabase
    .from('doctoralia_appointments_ingestion')
    .select(columns.join(','))
    .limit(1);

  if (error) throw error;
}

async function validateSchema(supabase) {
  try {
    await assertSelectableColumns(supabase, REQUIRED_COLUMNS);
    return { columnCount: REQUIRED_COLUMNS.length, usedLegacyInsertedAt: false };
  } catch (error) {
    if (!missingColumnError('imported_at').test(error.message || '')) {
      throw new Error(`doctoralia_appointments_ingestion schema validation failed: ${error.message}`);
    }

    await assertSelectableColumns(supabase, LEGACY_IMPORTED_AT_COLUMNS).catch((legacyError) => {
      throw new Error(
        'doctoralia_appointments_ingestion schema validation failed: missing `imported_at` and legacy `inserted_at` fallback failed. ' +
          `Apply supabase/migrations/20260608160000_align_doctoralia_appointments_runtime_schema.sql. Details: ${legacyError.message}`,
      );
    });

    console.warn(
      'validate-doctoralia-appointments-ready: `imported_at` column is missing, but `inserted_at` is present. ' +
        'Apply supabase/migrations/20260608160000_align_doctoralia_appointments_runtime_schema.sql to add `imported_at`.',
    );
    return { columnCount: REQUIRED_COLUMNS.length, usedLegacyInsertedAt: true };
  }
}

async function main() {
  const supabase = getSupabaseClient();
  const result = await validateSchema(supabase);
  const suffix = result.usedLegacyInsertedAt ? ' using legacy inserted_at timestamp fallback' : '';

  console.log(`doctoralia_appointments_ingestion schema validation passed (${result.columnCount} required columns${suffix}).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[validate-doctoralia-appointments-ready] Validation failed.');
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { REQUIRED_COLUMNS, LEGACY_IMPORTED_AT_COLUMNS, main, validateSchema };
