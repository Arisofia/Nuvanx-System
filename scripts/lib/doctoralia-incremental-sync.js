'use strict';

const { createHash } = require('node:crypto');

const DEFAULT_CHUNK_SIZE = 100;

// Fields whose source value is allowed to change for the same appointment slot.
// sheet_row/raw_data/import timestamps are audit metadata and must never force a
// rewrite when the underlying appointment has not changed.
const COMPARE_FIELDS = [
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
  'patient_name',
  'patient_email',
  'phone',
  'patient_phone',
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
];

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeKeyPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizePhone(value) {
  let phone = String(value || '').replace(/\D+/g, '');
  if (!phone || /^0+$/.test(phone)) return '';
  if (phone.startsWith('0034') && phone.length === 13) phone = phone.slice(4);
  if (phone.startsWith('34') && phone.length === 11) phone = phone.slice(2);
  return phone;
}

function patientIdentity(record) {
  const doctoraliaId = clean(record?.doctoralia_id);
  if (doctoraliaId) return `id:${normalizeKeyPart(doctoraliaId)}`;

  const phone = normalizePhone(record?.phone_normalized || record?.patient_phone || record?.phone);
  if (phone) return `ph:${phone}`;

  const patientName = normalizeKeyPart(record?.patient_name);
  if (patientName) return `name:${patientName}`;

  throw new Error('Doctoralia appointment cannot be keyed without patient identity');
}

/**
 * Stable appointment identity.
 *
 * Doctoralia export has no provider appointment id. The narrowest stable
 * business identity available is patient + scheduled date + scheduled time +
 * agenda. Mutable fields such as Estado, Importe, Concepto cita and sheet row
 * are intentionally excluded so lifecycle changes update the same DB row.
 */
function buildStableAppointmentSourceKey(record) {
  const appointmentDate = clean(record?.appointment_date);
  const appointmentTime = normalizeKeyPart(record?.appointment_time);
  const agenda = normalizeKeyPart(record?.agenda);

  if (!appointmentDate || !appointmentTime || !agenda) {
    throw new Error('Doctoralia appointment cannot be keyed without date, time and agenda');
  }

  const canonical = [
    patientIdentity(record),
    appointmentDate,
    appointmentTime,
    agenda,
  ].join('|');

  const digest = createHash('md5').update(canonical, 'utf8').digest('hex');
  return `doctoralia_appt_v3:${digest}`;
}

function canonicalizeRecord(record) {
  const sourceKey = buildStableAppointmentSourceKey(record);
  return {
    ...record,
    source_key: sourceKey,
    appointment_id: sourceKey,
    raw_data: {
      ...(record.raw_data || {}),
      source_key_version: 3,
    },
  };
}

function dedupeCanonicalRecords(records) {
  const byKey = new Map();
  for (const original of records) {
    const record = canonicalizeRecord(original);
    // Base Completa is append-like. If the same appointment slot appears more
    // than once, the later source row is the latest snapshot and wins.
    const existing = byKey.get(record.source_key);
    if (!existing || Number(record.sheet_row || 0) >= Number(existing.sheet_row || 0)) {
      byKey.set(record.source_key, record);
    }
  }
  return Array.from(byKey.values());
}

function normalizeComparable(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return String(value).trim();
}

function comparableSnapshot(record) {
  const snapshot = {};
  for (const field of COMPARE_FIELDS) snapshot[field] = normalizeComparable(record?.[field]);
  return snapshot;
}

function recordsDiffer(left, right) {
  return JSON.stringify(comparableSnapshot(left)) !== JSON.stringify(comparableSnapshot(right));
}

async function fetchExistingBySourceKey(supabase, sourceKeys, chunkSize = DEFAULT_CHUNK_SIZE) {
  const existing = new Map();
  const select = ['source_key', ...COMPARE_FIELDS].join(',');

  for (let index = 0; index < sourceKeys.length; index += chunkSize) {
    const keys = sourceKeys.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from('doctoralia_appointments_ingestion')
      .select(select)
      .in('source_key', keys);

    if (error) throw new Error(`[doctoralia-incremental] Failed to read existing appointments: ${error.message}`);
    for (const row of data || []) existing.set(row.source_key, row);
  }

  return existing;
}

function planIncrementalChanges(records, existingByKey) {
  const inserts = [];
  const updates = [];
  let unchanged = 0;

  for (const record of records) {
    const existing = existingByKey.get(record.source_key);
    if (!existing) {
      inserts.push(record);
    } else if (recordsDiffer(record, existing)) {
      updates.push(record);
    } else {
      unchanged += 1;
    }
  }

  return { inserts, updates, unchanged };
}

async function writeRecords(supabase, records, chunkSize = DEFAULT_CHUNK_SIZE) {
  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize).map((record) => ({
      ...record,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('doctoralia_appointments_ingestion')
      .upsert(chunk, { onConflict: 'source_key' });

    if (error) {
      throw new Error(
        `[doctoralia-incremental] Failed to upsert delta chunk ` +
        `(offset=${index}, size=${chunk.length}): ${error.message}`,
      );
    }
  }
}

async function syncIncrementalAppointments(records, { supabase, chunkSize = DEFAULT_CHUNK_SIZE } = {}) {
  if (!supabase) throw new Error('Supabase client is required for incremental Doctoralia sync');

  const canonical = dedupeCanonicalRecords(records);
  const existingByKey = await fetchExistingBySourceKey(
    supabase,
    canonical.map((record) => record.source_key),
    chunkSize,
  );
  const plan = planIncrementalChanges(canonical, existingByKey);
  const delta = [...plan.inserts, ...plan.updates];

  await writeRecords(supabase, delta, chunkSize);

  return {
    parsed: records.length,
    canonical: canonical.length,
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged,
    written: delta.length,
  };
}

module.exports = {
  COMPARE_FIELDS,
  buildStableAppointmentSourceKey,
  canonicalizeRecord,
  comparableSnapshot,
  dedupeCanonicalRecords,
  fetchExistingBySourceKey,
  patientIdentity,
  planIncrementalChanges,
  recordsDiffer,
  syncIncrementalAppointments,
};
