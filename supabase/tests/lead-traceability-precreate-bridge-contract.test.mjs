import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const preDropPath = 'supabase/migrations/20260901155995_pre_drop_legacy_lead_traceability.sql';
const reportingPath = 'supabase/migrations/20260901160000_fix_reporting_canonical_sources.sql';
const freshContractPath = 'supabase/migrations/20260901160001_reconcile_fresh_lead_traceability_contract.sql';
const appliedContractPath = 'supabase/migrations/20260901160050_reconcile_lead_traceability_public_contract.sql';

const preDrop = fs.readFileSync(preDropPath, 'utf8');
const reporting = fs.readFileSync(reportingPath, 'utf8');
const freshContract = fs.readFileSync(freshContractPath, 'utf8');
const appliedContract = fs.readFileSync(appliedContractPath, 'utf8');

describe('vw_lead_traceability clean-replay precreate bridge', () => {
  it('orders the pre-drop and fresh-contract bridges around immutable 160000 and before applied 160050', () => {
    expect(preDropPath.localeCompare(reportingPath)).toBeLessThan(0);
    expect(reportingPath.localeCompare(freshContractPath)).toBeLessThan(0);
    expect(freshContractPath.localeCompare(appliedContractPath)).toBeLessThan(0);
  });

  it('keeps Production canonical signatures on no-op paths', () => {
    expect(preDrop).toContain('IF v_signature = v_canonical_signature THEN');
    expect(freshContract).toContain('IF v_signature = v_canonical_signature THEN');
    const preDropCanonical = preDrop.indexOf('IF v_signature = v_canonical_signature THEN');
    const preDropDrop = preDrop.indexOf('DROP VIEW public.vw_lead_traceability;');
    expect(preDropCanonical).toBeGreaterThan(-1);
    expect(preDropCanonical).toBeLessThan(preDropDrop);
    const postCanonical = freshContract.indexOf('IF v_signature = v_canonical_signature THEN');
    const postDrop = freshContract.indexOf('DROP VIEW public.vw_lead_traceability;');
    expect(postCanonical).toBeGreaterThan(-1);
    expect(postCanonical).toBeLessThan(postDrop);
  });

  it('pre-drops only the exact historical Preview signature with exact security state', () => {
    expect(preDrop).toContain("v_historical_signature constant text := E'1:lead_id:uuid");
    expect(preDrop).toContain('26:patient_ltv:numeric');
    expect(preDrop).toContain('30:doctoralia_net:numeric');
    expect(preDrop).toContain('31:doctoralia_gross:numeric');
    expect(preDrop).toContain("v_owner_name IS DISTINCT FROM 'postgres'");
    expect(preDrop).toContain("'security_invoker=true' = ANY");
    expect(preDrop).toContain('v_view_comment IS NOT NULL');
    expect(preDrop).toContain('Cannot pre-drop historical vw_lead_traceability: dependent view exists');
    expect(preDrop).toContain("'anon:MAINTAIN:plain'");
    expect(preDrop).toContain("'authenticated:MAINTAIN:plain'");
    expect(preDrop).toContain("'service_role:MAINTAIN:plain'");
    expect(preDrop).toContain('Unexpected historical vw_lead_traceability ACL before 160000');
    expect(preDrop).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);
  });

  it('expects the exact fresh 160000 signature and exact Supabase PG16 default ACL', () => {
    expect(freshContract).toContain("v_fresh_signature constant text := E'1:lead_id:uuid");
    expect(freshContract).toContain('26:patient_ltv:numeric(14,2)');
    expect(freshContract).toContain('30:doctoralia_net:numeric(14,2)');
    expect(freshContract).toContain('31:doctoralia_gross:numeric(14,2)');
    expect(freshContract).toContain('Unexpected fresh vw_lead_traceability signature after 160000');
    expect(freshContract).toContain('v_expected_default_acl constant text[]');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) {
        expect(freshContract).toContain(`'${role}:${privilege}:plain'`);
      }
    }
    expect(freshContract).toContain('IF v_acl IS DISTINCT FROM v_expected_default_acl THEN');
    expect(freshContract).toContain('Unexpected non-owner ACL on fresh vw_lead_traceability after 160000');
  });

  it('rebuilds the exact canonical 43-column public contract with lossless narrowing guards', () => {
    for (const fragment of [
      'l.name::character varying(255) AS lead_name',
      'l.phone_normalized::character varying(20) AS phone_normalized',
      'p.total_ltv::numeric(12,2) AS patient_ltv',
      'fs.template_id::character varying(32) AS doctoralia_template_id',
      'fs.template_name::character varying(255) AS doctoralia_template_name',
      'fs.amount_net::numeric(12,2) AS doctoralia_net',
      'fs.amount_gross::numeric(12,2) AS doctoralia_gross',
      'p.phone::character varying(64) AS patient_phone',
    ]) {
      expect(freshContract).toContain(fragment);
    }
    expect(freshContract).toContain('lead text exceeds canonical varchar bounds');
    expect(freshContract).toContain('patients.total_ltv exceeds numeric(12,2) range');
    expect(freshContract).toContain('settlement amounts exceed numeric(12,2) range');
  });

  it('removes inherited defaults and proves canonical SELECT-only access before immutable 160050', () => {
    expect(freshContract).toContain('WITH (security_invoker = true) AS');
    expect(freshContract).toContain('REVOKE ALL PRIVILEGES ON TABLE public.vw_lead_traceability');
    expect(freshContract).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    expect(freshContract).toContain('GRANT SELECT ON TABLE public.vw_lead_traceability TO authenticated, service_role;');
    expect(freshContract).toContain("v_canonical_acl constant text[] := ARRAY[");
    expect(freshContract).toContain("'authenticated:SELECT:plain'");
    expect(freshContract).toContain("'service_role:SELECT:plain'");
    expect(freshContract).toContain('IF v_acl IS DISTINCT FROM v_canonical_acl THEN');
    expect(freshContract).toContain('Fresh vw_lead_traceability ACL reconciliation failed');
    expect(freshContract).toContain('Lead audit traceability restricted to active, unmerged leads while preserving the Production public column contract.');
    expect(appliedContract).toContain('-- Exact canonical Production signature: no mutation.');
  });
});
