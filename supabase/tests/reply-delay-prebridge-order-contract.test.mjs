import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const preBridgePath = 'supabase/migrations/20260901155990_pre_reconcile_reply_delay_integer_contract.sql';
const reportingPath = 'supabase/migrations/20260901160000_fix_reporting_canonical_sources.sql';
const laterRepairPath = 'supabase/migrations/20260902091000_reconcile_reply_delay_integer_contract.sql';

const preBridge = fs.readFileSync(preBridgePath, 'utf8');
const reporting = fs.readFileSync(reportingPath, 'utf8');
const laterRepair = fs.readFileSync(laterRepairPath, 'utf8');

describe('reply_delay_minutes pre-reporting replay bridge', () => {
  it('is ordered before the immutable reporting rebuild and before the later applied repair', () => {
    expect(preBridgePath.localeCompare(reportingPath)).toBeLessThan(0);
    expect(reportingPath.localeCompare(laterRepairPath)).toBeLessThan(0);
  });

  it('is a Production schema no-op on the canonical int4 contract', () => {
    expect(preBridge).toContain("v_data_type = 'integer' AND v_udt_name = 'int4'");
    const canonicalReturn = preBridge.indexOf("v_data_type = 'integer' AND v_udt_name = 'int4'");
    const firstDrop = preBridge.indexOf("'DROP VIEW %I.%I'");
    const alterType = preBridge.indexOf('ALTER COLUMN reply_delay_minutes TYPE integer');
    expect(canonicalReturn).toBeGreaterThan(-1);
    expect(canonicalReturn).toBeLessThan(firstDrop);
    expect(canonicalReturn).toBeLessThan(alterType);
  });

  it('repairs only the known nullable NUMERIC clean-replay shape and fails closed otherwise', () => {
    expect(preBridge).toContain("v_data_type = 'numeric'");
    expect(preBridge).toContain("v_udt_name = 'numeric'");
    expect(preBridge).toContain('v_default IS NULL');
    expect(preBridge).toContain("v_nullable = 'YES'");
    expect(preBridge).toContain('v_numeric_precision IS NULL');
    expect(preBridge).toContain('v_numeric_scale IS NULL');
    expect(preBridge).toContain('Unexpected public.leads.reply_delay_minutes contract');
    expect(preBridge).toContain('fractional or out-of-range value exists');
  });

  it('captures and rebuilds only the known dependency graph without CASCADE', () => {
    for (const view of [
      'public.source_to_cash',
      'public.v_figma_campaign_kpis',
      'public.vw_campaign_performance_real',
      'public.vw_lead_traceability',
      'public.vw_source_comparison',
    ]) {
      expect(preBridge).toContain(`'${view}'`);
    }
    expect(preBridge).toContain('Unexpected reply_delay_minutes dependent views during clean replay');
    expect(preBridge).not.toMatch(/DROP\s+VIEW[^;]*CASCADE/i);
    expect(preBridge).toContain('a.attacl IS NOT NULL');
  });

  it('moves the base column to integer before the reporting migration consumes it', () => {
    expect(preBridge).toContain('ALTER COLUMN reply_delay_minutes TYPE integer');
    expect(preBridge).toContain('USING reply_delay_minutes::integer');
    expect(reporting).toContain('CREATE OR REPLACE VIEW public.vw_lead_traceability');
    expect(reporting).toContain('l.reply_delay_minutes');
  });

  it('keeps the already-applied later repair compatible and idempotent', () => {
    expect(laterRepair).toContain("v_data_type = 'integer' AND v_udt_name = 'int4'");
    expect(laterRepair).toContain('ALTER COLUMN reply_delay_minutes TYPE integer');
    expect(laterRepair).toContain('Unexpected public.leads.reply_delay_minutes contract');
  });
});
