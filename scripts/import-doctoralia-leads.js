#!/usr/bin/env node
/**
 * import-doctoralia-leads.js
 *
 * Backfills the `leads` table with one row per financial settlement from
 * Doctoralia, so the Dashboard shows real Total Leads / Conversion Rate.
 *
 * Each settlement maps to a CLOSED lead (the patient paid and was treated).
 * The upsert key is (user_id, source, external_id) so the script is safe
 * to re-run at any time — it will never create duplicates.
 *
 * REQUIRED ENV:
 *   SUPABASE_URL              — e.g. https://ssvvuuysgxyqvmovrlvk.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — service-role secret
 *   CLINIC_ID                 — UUID of the clinic
 *   USER_ID                   — Supabase auth user UUID (owner of the leads)
 *
 * OPTIONAL:
 *   DRY_RUN=1      — preview rows without writing to DB
 *   LOAD_LOCAL_DOTENV=1 — load .env from repo root (local dev only)
 *
 * USAGE:
 *   CLINIC_ID=<uuid> USER_ID=<uuid> \
 *   SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/import-doctoralia-leads.js
 */

'use strict';

const path = require('node:path');
const fs   = require('node:fs');

const dotenvPath = path.join(__dirname, '..', '.env');
if (process.env.LOAD_LOCAL_DOTENV === '1' && fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CLINIC_ID,
  USER_ID,
} = process.env;
const DRY_RUN = process.env.DRY_RUN === '1';

const missing = [
  !SUPABASE_URL             && 'SUPABASE_URL',
  !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  !CLINIC_ID                && 'CLINIC_ID',
  !USER_ID                  && 'USER_ID',
].filter(Boolean);

if (missing.length) {
  console.error('Missing required env vars:', missing.join(', '));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  // Fetch all non-cancelled settlements for this clinic, joined with patient data
  const { data: settlements, error: settErr } = await supabase
    .from('financial_settlements')
    .select(`
      id,
      amount_net,
      template_name,
      settled_at,
      patient_id,
      patients (
        id,
        name,
        phone,
        email,
        dni
      )
    `)
    .eq('clinic_id', CLINIC_ID)
    .is('cancelled_at', null)
    .order('settled_at', { ascending: true });

  if (settErr) {
    console.error('Failed to fetch settlements:', settErr.message);
    process.exit(1);
  }

  console.log(`Found ${settlements.length} settlements for clinic ${CLINIC_ID}`);

  const leadRows = settlements.map((s) => {
    const patient = s.patients ?? {};
    return {
      user_id:              USER_ID,
      source:               'doctoralia',
      stage:                'closed',
      external_id:          s.id,                         // settlement id — dedup key
      name:                 patient.name   ?? null,
      phone:                patient.phone  ?? null,
      email:                patient.email  ?? null,
      dni:                  patient.dni    ?? null,
      revenue:              Number(s.amount_net ?? 0),
      converted_patient_id: patient.id    ?? null,
      notes:                s.template_name
                              ? JSON.stringify({ treatment: s.template_name })
                              : null,
      created_at:           s.settled_at,
    };
  });

  if (DRY_RUN) {
    const safePreview = leadRows.slice(0, 5).map((row) => ({
      source: row.source,
      stage: row.stage,
      external_id: row.external_id,
      revenue: row.revenue,
      created_at: row.created_at,
      has_notes: row.notes != null,
    }));
    console.log('\n[DRY RUN] First 5 sanitized rows that would be upserted:');
    console.log(JSON.stringify(safePreview, null, 2));
    console.log(`\n[DRY RUN] Total: ${leadRows.length} rows (no DB writes).`);
    return;
  }

  // Upsert in batches of 100 to stay within Supabase row limits
  const BATCH = 100;
  let upserted = 0;
  for (let i = 0; i < leadRows.length; i += BATCH) {
    const batch = leadRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('leads')
      .upsert(batch, { onConflict: 'user_id,source,external_id' });
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed:`, error.message);
    } else {
      upserted += batch.length;
      process.stdout.write(`  upserted ${upserted}/${leadRows.length}\r`);
    }
  }

  console.log(`\nDone. ${upserted} lead rows upserted from Doctoralia settlements.`);
}

main().catch((err) => {
  console.error('Unhandled error:', err.message ?? err);
  process.exit(1);
});
