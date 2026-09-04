import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('../migrations/20260904172000_retire_legacy_v_lead_traceability.sql', import.meta.url));
const migration = readFileSync(migrationPath, 'utf8');

describe('legacy v_lead_traceability retirement', () => {
  it('is Preview-safe and never cascades the legacy drop', () => {
    expect(migration).toContain("v_legacy_oid := to_regclass('public.v_lead_traceability');");
    expect(migration).toContain("public.v_lead_traceability absent; retirement is a no-op");
    expect(migration).toContain('DROP VIEW public.v_lead_traceability;');
    expect(migration).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);
  });

  it('requires the exact audited legacy identity and 24-column signature', () => {
    expect(migration).toContain("v_expected_legacy_signature constant text := E'1:id:uuid");
    expect(migration).toContain('24:total_ltv:numeric(12,2)');
    expect(migration).toContain("v_legacy_owner IS DISTINCT FROM 'postgres'");
    expect(migration).toContain("ARRAY['security_invoker=true']::text[]");
    expect(migration).toContain('Unexpected public.v_lead_traceability comment');
    expect(migration).toContain('Unexpected column ACL on public.v_lead_traceability');
  });

  it('recognizes and closes the known inherited ACL before retirement', () => {
    for (const role of ['anon', 'authenticated', 'postgres', 'service_role']) {
      for (const privilege of ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) {
        expect(migration).toContain(`'${role}:${privilege}:plain'`);
      }
    }
    const revoke = migration.indexOf('REVOKE ALL PRIVILEGES ON TABLE public.v_lead_traceability');
    const serviceRoleGrant = migration.indexOf('GRANT SELECT ON TABLE public.v_lead_traceability TO service_role;');
    const drop = migration.indexOf('DROP VIEW public.v_lead_traceability;');
    expect(revoke).toBeGreaterThan(-1);
    expect(serviceRoleGrant).toBeGreaterThan(revoke);
    expect(drop).toBeGreaterThan(serviceRoleGrant);
  });

  it('fails closed if the legacy view gains a new dependent object', () => {
    expect(migration).toContain("d.classid = 'pg_rewrite'::regclass");
    expect(migration).toContain("d.classid = 'pg_type'::regclass");
    expect(migration).toContain('v_external_dependents <> 0');
    expect(migration).toContain('unexpected dependents; refusing retirement');
  });

  it('proves the canonical vw_ contract before and after removing the legacy v_ object', () => {
    expect(migration).toContain("to_regclass('public.vw_lead_traceability') IS NULL");
    expect(migration).toContain("v_expected_canonical_signature constant text := E'1:lead_id:uuid");
    expect(migration).toContain('43:first_settlement_at:timestamp with time zone');
    expect(migration).toContain('Canonical public.vw_lead_traceability signature is not accepted');
    expect(migration).toContain('Canonical public.vw_lead_traceability disappeared during legacy retirement');
  });
});
