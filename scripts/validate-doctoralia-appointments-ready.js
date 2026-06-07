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

async function main() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('doctoralia_appointments_ingestion')
    .select(REQUIRED_COLUMNS.join(','))
    .limit(1);

  if (error) {
    throw new Error(`doctoralia_appointments_ingestion schema validation failed: ${error.message}`);
  }

  console.log(`doctoralia_appointments_ingestion schema validation passed (${REQUIRED_COLUMNS.length} required columns).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[validate-doctoralia-appointments-ready] Validation failed.');
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { REQUIRED_COLUMNS, main };
