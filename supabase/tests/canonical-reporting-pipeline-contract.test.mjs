import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260901160000_fix_reporting_canonical_sources.sql';
const apiPath = 'supabase/functions/api/index.ts';

const migration = fs.readFileSync(migrationPath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');

describe('Canonical Reporting Pipeline and E2E Contract', () => {
  it('defines get_campaign_report with tenant isolation, timestamp casting, and valid base scoping', () => {
    expect(migration).toContain('CREATE FUNCTION public.get_campaign_report(');
    expect(migration).toContain('p_user_id uuid,');
    expect(migration).toContain('COALESCE(c.timezone, \'UTC\') AS clinic_timezone');
    expect(migration).toContain('::timestamp AT TIME ZONE x.clinic_timezone');
    expect(migration).toContain('b.valuation_appointment_date <= CURRENT_DATE');
    expect(migration).not.toContain('p.appointment_status');
    expect(migration).toContain('COMMENT ON FUNCTION public.get_campaign_report(uuid, date, date, date, date)');
  });

  it('defines get_source_comparison with params CTE, timezone fallback, and correct boundary casting', () => {
    expect(migration).toContain('CREATE FUNCTION public.get_source_comparison(');
    expect(migration).toContain('WITH params AS (');
    expect(migration).toContain('COALESCE(c.timezone, \'UTC\') AS clinic_timezone');
    expect(migration).toContain('LEFT JOIN params x ON true');
    expect(migration).toContain('::timestamp AT TIME ZONE COALESCE(x.clinic_timezone, \'UTC\')');
    expect(migration).toContain('COMMENT ON FUNCTION public.get_source_comparison(uuid, text, text)');
  });

  it('defines get_campaign_roi with correct CTE declaration order and localized month truncation', () => {
    expect(migration).toContain('CREATE FUNCTION public.get_campaign_roi(');
    const baseWithSourceIndex = migration.indexOf('lead_base_with_source AS (');
    const rollupIndex = migration.indexOf('lead_rollup AS (');
    expect(baseWithSourceIndex).toBeGreaterThan(-1);
    expect(rollupIndex).toBeGreaterThan(-1);
    expect(baseWithSourceIndex).toBeLessThan(rollupIndex);

    expect(migration).toContain("date_trunc('month', l.created_at AT TIME ZONE COALESCE(uc.clinic_timezone, 'UTC'))::date");
    expect(migration).toContain('COMMENT ON FUNCTION public.get_campaign_roi(uuid, text, text, text)');
  });

  it('invokes get_campaign_report with authenticated user ID in handleCampaignsFilter', () => {
    expect(api).toContain("adminClient.rpc('get_campaign_report', {");
    expect(api).toContain('p_user_id: userId');
    expect(api).toContain('p_from_date: since');
    expect(api).toContain('p_to_date: until');
  });

  it('queries vw_lead_traceability in buildLeadAuditQuery without selecting unprojected columns', () => {
    const auditQuerySection = api.slice(api.indexOf('function buildLeadAuditQuery'), api.indexOf('function buildLeadAuditQuery') + 1200);
    expect(auditQuerySection).toContain(".eq('lead_user_id', userId)");
    expect(auditQuerySection).not.toContain(".is('deleted_at', null)");
    expect(auditQuerySection).not.toContain(".is('merged_into_lead_id', null)");
  });

  it('defines vw_doctor_performance_real with Doctoralia ingestion priority and settlement verified revenue', () => {
    expect(migration).toContain('CREATE OR REPLACE VIEW public.vw_doctor_performance_real AS');
    expect(migration).toContain('public.doctoralia_appointments_ingestion');
    expect(migration).toContain('public.financial_settlements');
    expect(migration).toContain('COMMENT ON VIEW public.vw_doctor_performance_real');
  });
});
