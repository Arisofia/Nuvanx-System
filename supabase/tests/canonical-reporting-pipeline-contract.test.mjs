import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260901160000_fix_reporting_canonical_sources.sql';
const apiPath = 'supabase/functions/api/index.ts';

const migration = fs.readFileSync(migrationPath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');

describe('Canonical Reporting Pipeline and E2E Contract', () => {
  it('defines get_campaign_report with tenant isolation, local boundaries, and evidence-based attendance', () => {
    expect(migration).toContain('CREATE FUNCTION public.get_campaign_report(');
    expect(migration).toContain('p_user_id uuid,');
    expect(migration).toContain("COALESCE(c.timezone, 'UTC') AS clinic_timezone");
    expect(migration).toContain('WHERE l.user_id = p_user_id');
    expect(migration).toContain('AT TIME ZONE x.clinic_timezone');

    expect(migration).toContain('public.lead_appointment_matches lam');
    expect(migration).toContain('public.doctoralia_appointments_ingestion anchor');
    expect(migration).toContain('public.doctoralia_appointments_ingestion appt');
    expect(migration).toContain('AS valuation_attended');
    expect(migration).toContain('WHERE b.valuation_attended OR b.is_new_client');
    expect(migration).not.toContain('b.valuation_appointment_date <= CURRENT_DATE');
    expect(migration).not.toContain('p.appointment_status');

    expect(migration).toContain('COMMENT ON FUNCTION public.get_campaign_report(uuid, date, date, date, date)');
  });

  it('defines get_source_comparison with tenant scoping and clinic-local semi-open boundaries', () => {
    expect(migration).toContain('CREATE FUNCTION public.get_source_comparison(');
    expect(migration).toContain('WITH params AS (');
    expect(migration).toContain("COALESCE(c.timezone, 'UTC') AS clinic_timezone");
    expect(migration).toContain('LEFT JOIN params x ON true');
    expect(migration).toContain("p_from::date::timestamp AT TIME ZONE COALESCE(x.clinic_timezone, 'UTC')");
    expect(migration).toContain("((p_to::date + 1)::timestamp) AT TIME ZONE COALESCE(x.clinic_timezone, 'UTC')");
    expect(migration).toContain('COMMENT ON FUNCTION public.get_source_comparison(uuid, text, text)');
  });

  it('defines get_campaign_roi with localized month truncation and a Google-only spend guard', () => {
    expect(migration).toContain('CREATE FUNCTION public.get_campaign_roi(');
    const baseWithSourceIndex = migration.indexOf('lead_base_with_source AS (');
    const rollupIndex = migration.indexOf('lead_rollup AS (');
    expect(baseWithSourceIndex).toBeGreaterThan(-1);
    expect(rollupIndex).toBeGreaterThan(-1);
    expect(baseWithSourceIndex).toBeLessThan(rollupIndex);

    expect(migration).toContain("date_trunc('month', l.created_at AT TIME ZONE COALESCE(uc.clinic_timezone, 'UTC'))::date");
    expect(migration).toContain("WHEN lb.source IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'google'");
    expect(migration).toContain("WHEN r.source_category = 'google'");
    expect(migration).toContain('COMMENT ON FUNCTION public.get_campaign_roi(uuid, text, text, text)');
  });

  it('invokes reporting RPCs with the authenticated user ID', () => {
    expect(api).toContain("adminClient.rpc('get_campaign_report', {");
    expect(api).toContain('p_user_id: userId');
    expect(api).toContain('p_from_date: since');
    expect(api).toContain('p_to_date: until');
    expect(api).toContain("adminClient.rpc('get_source_comparison', {");
  });

  it('keeps lead-audit filtering in the SSOT view instead of querying unprojected columns', () => {
    const auditQuerySection = api.slice(api.indexOf('function buildLeadAuditQuery'), api.indexOf('function buildLeadAuditQuery') + 1200);
    expect(auditQuerySection).toContain(".eq('lead_user_id', userId)");
    expect(auditQuerySection).not.toContain(".is('deleted_at', null)");
    expect(auditQuerySection).not.toContain(".is('merged_into_lead_id', null)");

    expect(migration).toContain('CREATE OR REPLACE VIEW public.vw_lead_traceability');
    expect(migration).toContain('WHERE l.deleted_at IS NULL');
    expect(migration).toContain('AND l.merged_into_lead_id IS NULL;');
  });

  it('preserves doctor performance column order and uses Doctoralia ingestion', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.vw_doctor_performance_real AS');
    expect(migration).toContain('public.doctoralia_appointments_ingestion');
    expect(migration).toContain('public.financial_settlements');

    const doctorSelect = migration.slice(
      migration.indexOf('SELECT\n  c.doctor_id,'),
      migration.indexOf('FROM combined c;')
    );
    expect(doctorSelect.indexOf('c.clinic_id')).toBeGreaterThan(-1);
    expect(doctorSelect.indexOf('c.total_appointments')).toBeGreaterThan(-1);
    expect(doctorSelect.indexOf('c.clinic_id')).toBeLessThan(doctorSelect.indexOf('c.total_appointments'));
    expect(migration).toContain('COMMENT ON VIEW public.vw_doctor_performance_real');
  });
});
