import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const appliedHotfixPath = 'supabase/migrations/20260902173941_fix_vw_lead_traceability_type_conflict.sql';
const aclRepairPath = 'supabase/migrations/20260902180000_reconcile_vw_lead_traceability_acl.sql';

const appliedHotfix = fs.readFileSync(appliedHotfixPath, 'utf8');
const aclRepair = fs.readFileSync(aclRepairPath, 'utf8');

describe('vw_lead_traceability applied-hotfix ledger contract', () => {
  it('keeps the recovered applied 173941 artifact explicit and ordered before the forward repair', () => {
    expect(appliedHotfixPath.localeCompare(aclRepairPath)).toBeLessThan(0);
    expect(appliedHotfix).toContain('DROP VIEW IF EXISTS public.vw_lead_traceability;');
    expect(appliedHotfix).toContain('WITH (security_invoker = true) AS');
    expect(appliedHotfix).toContain('GRANT ALL ON public.vw_lead_traceability TO anon;');
    expect(appliedHotfix).toContain('GRANT ALL ON public.vw_lead_traceability TO authenticated;');
    expect(appliedHotfix).toContain('GRANT ALL ON public.vw_lead_traceability TO service_role;');
  });

  it('accepts only the exact canonical 43-column view contract before changing ACLs or metadata', () => {
    expect(aclRepair).toContain("v_signature IS DISTINCT FROM E'1:lead_id:uuid");
    expect(aclRepair).toContain('18:reply_delay_minutes:integer');
    expect(aclRepair).toContain('43:first_settlement_at:timestamp with time zone');
    expect(aclRepair).toContain('Unexpected vw_lead_traceability signature before ACL reconciliation');
    expect(aclRepair).toContain("v_owner_name IS DISTINCT FROM 'postgres'");
    expect(aclRepair).toContain("'security_invoker=true' = ANY");
  });

  it('fails closed on column-level ACLs, unknown relation ACLs, and unknown comments', () => {
    expect(aclRepair).toContain('a.attacl IS NOT NULL');
    expect(aclRepair).toContain('Cannot reconcile vw_lead_traceability ACL: column-level ACLs detected');
    expect(aclRepair).toContain('Unexpected vw_lead_traceability ACL before reconciliation');
    expect(aclRepair).toContain('Unexpected vw_lead_traceability comment before reconciliation');
  });

  it('accepts the canonical SELECT-only ACL without rewriting it', () => {
    expect(aclRepair).toContain("'authenticated:SELECT:plain'");
    expect(aclRepair).toContain("'service_role:SELECT:plain'");
    expect(aclRepair).toContain('v_acl IS DISTINCT FROM v_canonical_acl');
    expect(aclRepair).toContain('IF v_acl = v_hotfix_acl THEN');
  });

  it('repairs only the observed GRANT ALL hotfix state to SELECT-only authenticated/service_role', () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const privilege of ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) {
        expect(aclRepair).toContain(`'${role}:${privilege}:plain'`);
      }
    }
    expect(aclRepair).toContain('v_acl IS DISTINCT FROM v_hotfix_acl');
    expect(aclRepair).toContain('REVOKE ALL PRIVILEGES ON TABLE public.vw_lead_traceability');
    expect(aclRepair).toContain('FROM PUBLIC, anon, authenticated, service_role;');
    expect(aclRepair).toContain('GRANT SELECT ON TABLE public.vw_lead_traceability TO authenticated, service_role;');
    expect(aclRepair).not.toMatch(/GRANT\s+ALL[^;]*TO\s+(anon|authenticated|service_role)/i);
  });

  it('restores the canonical view comment when the applied hotfix dropped it', () => {
    const canonicalComment = 'Lead audit traceability restricted to active, unmerged leads while preserving the Production public column contract.';
    expect(aclRepair).toContain('pg_catalog.obj_description(c.oid');
    expect(aclRepair).toContain(`v_canonical_comment constant text :=\n    '${canonicalComment}'`);
    expect(aclRepair).toContain('IF v_view_comment IS NULL THEN');
    expect(aclRepair).toContain('COMMENT ON VIEW public.vw_lead_traceability IS');
    expect(aclRepair).toContain(canonicalComment);
  });
});
