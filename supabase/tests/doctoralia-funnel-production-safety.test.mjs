import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260831173000_repair_funnel_and_source_to_cash_contracts.sql',
  'utf8',
);

describe('Doctoralia funnel production-safe repair', () => {
  it('never hides the workload problem by increasing statement_timeout', () => {
    expect(migration).not.toMatch(/SET\s+(LOCAL\s+)?statement_timeout/i);
  });

  it('disables only the two expensive ingestion triggers around the one-time metadata normalization', () => {
    expect(migration).toMatch(/DISABLE TRIGGER trg_guard_exact_doctoralia_appointment_duplicate/);
    expect(migration).toMatch(/DISABLE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row/);
    expect(migration).toMatch(/ENABLE TRIGGER trg_guard_exact_doctoralia_appointment_duplicate/);
    expect(migration).toMatch(/ENABLE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row/);
  });

  it('updates derived Doctoralia metadata only when the canonical value actually differs', () => {
    expect(migration).toMatch(/a\.funnel_stage IS DISTINCT FROM e\.funnel_stage/);
    expect(migration).toMatch(/a\.funnel_stage_reason IS DISTINCT FROM e\.funnel_stage_reason/);
  });

  it('preserves the canonical control, cancellation and no-show mapping', () => {
    expect(migration).toMatch(/WHEN a\.is_control THEN NULL::text/);
    expect(migration).toMatch(/'control_excluido'::text/);
    expect(migration).toMatch(/'valoracion_cancelada'::text/);
    expect(migration).toMatch(/'valoracion_no_asistio'::text/);
    expect(migration).toMatch(/'valoracion_no_cancelada'::text/);
    expect(migration).toMatch(/THEN 'asistio'::text/);
  });

  it('hardens the existing canonical refresh owner instead of inventing a second runtime mapping', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.refresh_doctoralia_funnel\(p_user_id uuid\)/);
    expect(migration).toMatch(/SECURITY DEFINER/);
    expect(migration).toMatch(/SET search_path TO 'public', 'pg_catalog'/);
    expect(migration).toMatch(/PERFORM public\.refresh_doctoralia_funnel\(v_user_id\)/);
  });

  it('keeps the source-to-cash repair dependency-safe', () => {
    expect(migration).toMatch(/CREATE OR REPLACE VIEW public\.source_to_cash/);
    expect(migration).not.toMatch(/DROP VIEW IF EXISTS public\.source_to_cash/);
  });
});
