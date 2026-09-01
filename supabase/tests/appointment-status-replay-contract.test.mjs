import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const leadsBase = readFileSync('supabase/migrations/20260501090000_create_leads_table.sql', 'utf8');
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

  it('runs before the reporting migration that requires enum comparison semantics', () => {
    expect('20260901155900').toBeLessThan('20260901160000');
    expect(reporting).toContain("l.appointment_status = 'showed'::public.appointment_status");
  });
});
