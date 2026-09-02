import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260901160000_fix_reporting_canonical_sources.sql';
const doctorBridgePath = 'supabase/migrations/20260901155999_pre_reconcile_doctor_performance_order.sql';
const leadBridgePath = 'supabase/migrations/20260901160050_reconcile_lead_traceability_public_contract.sql';
const apiPath = 'supabase/functions/api/index.ts';

const migration = fs.readFileSync(migrationPath, 'utf8');
const doctorBridge = fs.readFileSync(doctorBridgePath, 'utf8');
const leadBridge = fs.readFileSync(leadBridgePath, 'utf8');
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

  it('keeps lead-audit filtering in the SSOT and canonicalizes the replay public types forward-only', () => {
    const auditQuerySection = api.slice(api.indexOf('function buildLeadAuditQuery'), api.indexOf('function buildLeadAuditQuery') + 1200);
    expect(auditQuerySection).toContain(".eq('lead_user_id', userId)");
    expect(auditQuerySection).not.toContain(".is('deleted_at', null)");
    expect(auditQuerySection).not.toContain(".is('merged_into_lead_id', null)");

    expect(migration).toContain('CREATE OR REPLACE VIEW public.vw_lead_traceability');
    expect(migration).toContain('WHERE l.deleted_at IS NULL');
    expect(migration).toContain('AND l.merged_into_lead_id IS NULL;');

    expect(leadBridge).toContain('l.reply_delay_minutes::integer AS reply_delay_minutes');
    expect(leadBridge).toContain('p.total_ltv::numeric(12,2) AS patient_ltv');
    expect(leadBridge).toContain('fs.amount_net::numeric(12,2) AS doctoralia_net');
    expect(leadBridge).toContain('fs.amount_gross::numeric(12,2) AS doctoralia_gross');
    expect(leadBridge).toContain('WHERE l.deleted_at IS NULL');
    expect(leadBridge).toContain('AND l.merged_into_lead_id IS NULL');
  });

  it('uses one fail-closed forward bridge for the exact measured lead-audit Production and replay signatures', () => {
    expect(leadBridge).toContain('Unexpected vw_lead_traceability signature');
    expect(leadBridge).toContain("1:lead_id:uuid\\n2:lead_name:character varying(255)\\n3:email_normalized:text\\n4:phone_normalized:character varying(20)");
    expect(leadBridge).toContain("1:lead_id:uuid\\n2:lead_name:text\\n3:email_normalized:text\\n4:phone_normalized:text");
    expect(leadBridge).toContain('18:reply_delay_minutes:integer\\n19:appointment_status:appointment_status');
    expect(leadBridge).toContain('39:patient_last_visit:timestamp with time zone');
    expect(leadBridge).toContain('43:first_settlement_at:timestamp with time zone');
    expect(leadBridge).toContain('Cannot rebuild legacy vw_lead_traceability: dependent view exists');
    expect(leadBridge).toContain('DROP VIEW public.vw_lead_traceability;');
    expect(leadBridge).not.toMatch(/DROP\s+VIEW\s+public\.vw_lead_traceability[^;]*CASCADE/i);
    expect(leadBridge.match(/DO \$lead_audit_bridge\$/g) ?? []).toHaveLength(1);
    expect(leadBridge).toContain('nvx_lead_audit_acl');
    expect(leadBridge).toContain('l.name::character varying(255) AS lead_name');
    expect(leadBridge).toContain('l.phone_normalized::character varying(20) AS phone_normalized');
    expect(leadBridge).toContain('fs.template_id::character varying(32) AS doctoralia_template_id');
    expect(leadBridge).toContain('p.phone::character varying(64) AS patient_phone');
    expect(leadBridge).toContain('patients.total_ltv exceeds numeric(12,2) range');
    expect(leadBridge).toContain('settlement amounts exceed numeric(12,2) range');
  });

  it('rebuilds only the exact measured incompatible legacy doctor signature before immutable 160000', () => {
    expect(doctorBridge).toContain('Unexpected vw_doctor_performance_real signature before reporting migration');
    expect(doctorBridge).toContain("1:doctor_id:uuid\\n2:doctor_name:character varying(255)\\n3:specialty:character varying(128)\\n4:is_active:boolean\\n5:clinic_id:uuid");
    expect(doctorBridge).toContain("1:doctor_id:uuid\\n2:doctor_name:text\\n3:specialty:text\\n4:is_active:boolean\\n5:total_appointments:bigint");
    expect(doctorBridge).toContain('13:verified_revenue_crm:numeric\\n14:clinic_id:uuid');
    expect(doctorBridge).toContain('Cannot rebuild legacy vw_doctor_performance_real: dependent view exists');
    expect(doctorBridge).toContain('DROP VIEW public.vw_doctor_performance_real;');
    expect(doctorBridge).not.toMatch(/DROP\s+VIEW\s+public\.vw_doctor_performance_real[^;]*CASCADE/i);
    expect(doctorBridge).toContain('nvx_doctor_pre_acl');
    expect(doctorBridge).toContain('column-level ACLs detected');
  });

  it('preserves doctor performance column order and uses Doctoralia ingestion in immutable reporting', () => {
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

  it('keeps immutable applied migrations untouched and places replay hardening around them', () => {
    expect(Number('20260901155999')).toBeLessThan(Number('20260901160000'));
    expect(Number('20260901160050')).toBeGreaterThan(Number('20260901160000'));
    expect(doctorBridge).not.toContain('20260901160000_fix_reporting_canonical_sources.sql');
    expect(leadBridge).toContain('immutable 20260901160000');
  });
});