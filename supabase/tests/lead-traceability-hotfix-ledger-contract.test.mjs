import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const appliedHotfixPath = 'supabase/migrations/20260902173941_fix_vw_lead_traceability_type_conflict.sql';
const repairPath = 'supabase/migrations/20260902180000_reconcile_vw_lead_traceability_acl.sql';

const appliedHotfix = fs.readFileSync(appliedHotfixPath, 'utf8');
const repair = fs.readFileSync(repairPath, 'utf8');
const executableRepair = repair
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('vw_lead_traceability applied-hotfix ledger contract', () => {
  it('keeps the recovered applied 173941 artifact explicit and ordered before the forward repair', () => {
    expect(appliedHotfixPath.localeCompare(repairPath)).toBeLessThan(0);
    expect(appliedHotfix).toContain('DROP VIEW IF EXISTS public.vw_lead_traceability;');
    expect(appliedHotfix).toContain('WITH (security_invoker = true) AS');
    expect(appliedHotfix).toContain('GRANT ALL ON public.vw_lead_traceability TO anon;');
    expect(appliedHotfix).toContain('GRANT ALL ON public.vw_lead_traceability TO authenticated;');
    expect(appliedHotfix).toContain('GRANT ALL ON public.vw_lead_traceability TO service_role;');
  });

  it('accepts only canonical or exact replayed-hotfix 43-column signatures', () => {
    expect(repair).toContain("v_canonical_signature constant text := E'1:lead_id:uuid");
    expect(repair).toContain("v_hotfix_replay_signature constant text := E'1:lead_id:uuid");
    expect(repair).toContain('26:patient_ltv:numeric(14,2)');
    expect(repair).toContain('30:doctoralia_net:numeric(14,2)');
    expect(repair).toContain('31:doctoralia_gross:numeric(14,2)');
    expect(repair).toContain('26:patient_ltv:numeric(12,2)');
    expect(repair).toContain('Unexpected vw_lead_traceability signature after applied 173941');
    expect(repair).toContain("v_owner_name IS DISTINCT FROM 'postgres'");
    expect(repair).toContain("v_reloptions IS DISTINCT FROM ARRAY['security_invoker=true']::text[]");
  });

  it('locks the exact PG16 hotfix ACL including MAINTAIN', () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) {
        expect(repair).toContain(`'${role}:${privilege}:plain'`);
      }
    }
    expect(repair).toContain('Unexpected ACL on replayed 173941 view');
  });

  it('fails closed on column ACLs, unknown comments and dependent views before structural rebuild', () => {
    expect(repair).toContain('a.attacl IS NOT NULL');
    expect(repair).toContain('Cannot reconcile vw_lead_traceability: column-level ACLs detected');
    expect(repair).toContain('Unexpected vw_lead_traceability comment after applied 173941');
    expect(repair).toContain('Cannot rebuild replayed 173941 vw_lead_traceability: dependent view exists');
    expect(executableRepair).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);
  });

  it('rebuilds the replayed hotfix signature to the canonical narrowed public contract', () => {
    expect(repair).toContain('IF v_signature = v_hotfix_replay_signature THEN');
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
      expect(repair).toContain(fragment);
    }
    expect(repair).toContain('lead text exceeds canonical varchar bounds');
    expect(repair).toContain('patients.total_ltv exceeds numeric(12,2) range');
    expect(repair).toContain('settlement amounts exceed numeric(12,2) range');
  });

  it('repairs broad/default privileges to canonical SELECT-only access', () => {
    expect(repair).toContain('REVOKE ALL PRIVILEGES ON TABLE public.vw_lead_traceability');
    expect(repair).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    expect(repair).toContain('GRANT SELECT ON TABLE public.vw_lead_traceability TO authenticated, service_role;');
    expect(repair).toContain("v_canonical_acl constant text[] := ARRAY[");
    expect(repair).toContain("'authenticated:SELECT:plain'");
    expect(repair).toContain("'service_role:SELECT:plain'");
    expect(executableRepair).not.toMatch(/GRANT\s+ALL[^;]*TO\s+(anon|authenticated|service_role)/i);
  });

  it('restores canonical metadata and asserts exact postconditions before commit', () => {
    const canonicalComment = 'Lead audit traceability restricted to active, unmerged leads while preserving the Production public column contract.';
    expect(repair).toContain('pg_catalog.obj_description(c.oid');
    expect(repair).toContain(`v_canonical_comment constant text :=\n    '${canonicalComment}'`);
    expect(repair).toContain('COMMENT ON VIEW public.vw_lead_traceability IS');
    expect(repair).toContain(canonicalComment);
    expect(repair).toContain('vw_lead_traceability signature reconciliation failed');
    expect(repair).toContain('vw_lead_traceability ACL reconciliation failed');
    expect(repair).toContain('vw_lead_traceability comment reconciliation failed');
  });
});
