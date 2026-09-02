import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const leadsBase = readFileSync('supabase/migrations/20260501090000_create_leads_table.sql', 'utf8');
const historicalUnified = readFileSync('supabase/migrations/20260527000000_add_fbc_fbp_to_traceability_view.sql', 'utf8');
const clinicalBridge = readFileSync('supabase/migrations/20260830223430_reconcile_clinical_core_contract.sql', 'utf8');
const typeBridge = readFileSync('supabase/migrations/20260901155900_reconcile_leads_appointment_status_type.sql', 'utf8');
const reporting = readFileSync('supabase/migrations/20260901160000_fix_reporting_canonical_sources.sql', 'utf8');

describe('clean replay appointment-status type contract', () => {
  it('documents the historical TEXT source and canonical enum target', () => {
    expect(leadsBase).toContain('appointment_status TEXT');
    expect(clinicalBridge).toContain('CREATE TYPE public.appointment_status AS ENUM');
  });

  it('repairs only fresh-replay TEXT columns and is a no-op for canonical Production', () => {
    expect(typeBridge).toContain("v_udt_schema = 'public' AND v_udt_name = 'appointment_status'");
    expect(typeBridge).toContain("v_udt_schema = 'pg_catalog' AND v_udt_name = 'text'");
    expect(typeBridge).toContain('ALTER COLUMN appointment_status TYPE public.appointment_status');
    expect(typeBridge).toContain('USING appointment_status::public.appointment_status');
  });

  it('fails closed instead of coercing unknown historical statuses', () => {
    for (const status of ['scheduled', 'confirmed', 'showed', 'no_show', 'cancelled']) {
      expect(typeBridge).toContain(`'${status}'`);
    }
    expect(typeBridge).toContain('unsupported historical value exists');
    expect(typeBridge).not.toMatch(/UPDATE\s+public\.leads/i);
  });

  it('captures and rebuilds dependent views without blind CASCADE deletion', () => {
    expect(typeBridge).toContain('WITH RECURSIVE target AS');
    expect(typeBridge).toContain('pg_catalog.pg_get_viewdef(v.oid, true)');
    expect(typeBridge).toContain('ORDER BY dependency_depth DESC');
    expect(typeBridge).toContain('ORDER BY dependency_depth ASC');
    expect(typeBridge).toContain("'DROP VIEW %I.%I'");
    expect(typeBridge).toContain("'CREATE VIEW %I.%I AS %s'");
    expect(typeBridge).toContain('pg_catalog.aclexplode(c.relacl)');
    expect(typeBridge).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);
  });

  it('repairs only the historical Doctoralia TEXT/enum COALESCE boundary', () => {
    expect(historicalUnified).toMatch(/COALESCE\s*\(\s*dr\.estado::TEXT\s*,\s*l\.appointment_status\s*\)/i);
    expect(typeBridge).toContain("'COALESCE(dr.estado::text, l.appointment_status)'");
    expect(typeBridge).toContain("'COALESCE(dr.estado::text, l.appointment_status::text)'");
    expect(typeBridge).toContain("r.view_name = 'vw_doctoralia_lead_traceability_unified'");
    expect(typeBridge).toContain('expected appointment_status text COALESCE boundary is missing');
    expect(typeBridge).toContain('Failed to make historical unified Doctoralia view enum-replay-safe');

    // A broad cast deletion/rewrite would mutate unrelated saved view contracts.
    expect(typeBridge).not.toMatch(/replace\s*\([^;]*['"]::text['"]/is);
  });

  it('preserves view and column comments across the controlled DROP/CREATE', () => {
    expect(historicalUnified).toContain('COMMENT ON COLUMN public.vw_doctoralia_lead_traceability_unified.lead_fbc');
    expect(historicalUnified).toContain('COMMENT ON COLUMN public.vw_doctoralia_lead_traceability_unified.lead_fbp');
    expect(typeBridge).toContain("pg_catalog.obj_description(v.oid, 'pg_class')");
    expect(typeBridge).toContain('nvx_appointment_status_view_column_comment');
    expect(typeBridge).toContain('pg_catalog.col_description(r.view_oid, a.attnum)');
    expect(typeBridge).toContain("'COMMENT ON VIEW %I.%I IS %L'");
    expect(typeBridge).toContain("'COMMENT ON COLUMN %I.%I.%I IS %L'");
  });

  it('prepares incompatible historical reporting views for canonical recreation', () => {
    expect(typeBridge).toContain("to_regclass('public.vw_doctor_performance_real') IS NOT NULL");
    expect(typeBridge).toContain("EXECUTE 'DROP VIEW public.vw_doctor_performance_real'");
    expect(typeBridge).toContain("to_regclass('public.vw_lead_traceability') IS NOT NULL");
    expect(typeBridge).toContain("EXECUTE 'DROP VIEW public.vw_lead_traceability'");
    expect(typeBridge).toContain('CREATE OR REPLACE VIEW with SQLSTATE 42P16');
    expect(typeBridge).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);

    expect(reporting).toContain('CREATE OR REPLACE VIEW public.vw_doctor_performance_real AS');
    expect(reporting).toContain('CREATE OR REPLACE VIEW public.vw_lead_traceability');
  });

  it('runs before the reporting migration that requires enum comparison semantics', () => {
    expect(Number('20260901155900')).toBeLessThan(Number('20260901160000'));
    expect(reporting).toContain("l.appointment_status = 'showed'::public.appointment_status");
  });
});
