import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260902091000_reconcile_reply_delay_integer_contract.sql',
  'utf8'
);

describe('reply_delay_minutes clean-replay contract', () => {
  it('is a Production no-op when the canonical int4 type already exists', () => {
    expect(migration).toContain("v_data_type = 'integer' AND v_udt_name = 'int4'");
  });

  it('repairs only the known nullable numeric replay shape', () => {
    expect(migration).toContain("v_data_type = 'numeric'");
    expect(migration).toContain("v_udt_name = 'numeric'");
    expect(migration).toContain("v_default IS NULL");
    expect(migration).toContain("v_nullable = 'YES'");
    expect(migration).toContain('Unexpected public.leads.reply_delay_minutes contract');
  });

  it('fails closed instead of silently rounding or overflowing values', () => {
    expect(migration).toContain('l.reply_delay_minutes <> trunc(l.reply_delay_minutes)');
    expect(migration).toContain('-2147483648::numeric');
    expect(migration).toContain('2147483647::numeric');
    expect(migration).toContain('fractional or out-of-range value exists');
    expect(migration).not.toMatch(/UPDATE\s+public\.leads/i);
  });

  it('rebuilds only the observed dependent replay views without CASCADE', () => {
    for (const view of [
      'public.source_to_cash',
      'public.v_figma_campaign_kpis',
      'public.vw_campaign_performance_real',
      'public.vw_lead_traceability',
      'public.vw_source_comparison',
    ]) {
      expect(migration).toContain(`'${view}'`);
    }

    expect(migration).toContain('Unexpected reply_delay_minutes dependent views during clean replay');
    expect(migration).toContain('ORDER BY dependency_depth DESC');
    expect(migration).toContain('ORDER BY dependency_depth ASC');
    expect(migration).toContain("'DROP VIEW %I.%I'");
    expect(migration).toContain("'CREATE VIEW %I.%I AS %s'");
    expect(migration).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);
  });

  it('converts the base column to integer and preserves view metadata', () => {
    expect(migration).toContain('ALTER COLUMN reply_delay_minutes TYPE integer');
    expect(migration).toContain('USING reply_delay_minutes::integer');
    expect(migration).toContain('pg_catalog.pg_get_viewdef(v.oid, true)');
    expect(migration).toContain('pg_catalog.aclexplode(c.relacl)');
    expect(migration).toContain('nvx_reply_delay_view_restore');
    expect(migration).toContain('nvx_reply_delay_view_acl');
  });
});
