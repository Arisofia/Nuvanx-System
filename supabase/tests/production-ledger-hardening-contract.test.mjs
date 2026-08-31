import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const hardening = fs.readFileSync(
  'supabase/migrations/20260831172000_harden_traceability_tenant_and_dispatch_threshold.sql',
  'utf8',
);

const staleCleanupHistory = fs.readFileSync(
  'supabase/migrations/20260831140045_fix_revops_dispatch_ledger_stale_cleanup.sql',
  'utf8',
);

const traceabilityHistory = fs.readFileSync(
  'supabase/migrations/20260831140838_fix_master_pacientes_trazabilidad_use_dai_v2.sql',
  'utf8',
);

describe('Production ledger reconciliation hardening', () => {
  it('preserves the restored applied-history files and fixes issues only in a forward migration', () => {
    expect(staleCleanupHistory).toMatch(/nvx-revops-dispatch-stale-cleanup/);
    expect(traceabilityHistory).toMatch(/JOIN doctoralia_appointments_ingestion dai/);
    expect(hardening).toMatch(/Do not rewrite the already-applied historical migrations/);
  });

  it('requires exact tenant resolution before exposing Doctoralia traceability', () => {
    expect(hardening).toMatch(/JOIN public\.clinics c/);
    expect(hardening).toMatch(/c\.name = dai\.clinic/);
    expect(hardening).toMatch(/c\.id = l\.clinic_id/);
    expect(hardening).not.toMatch(/pi\.clinic_id IS NULL OR/);
  });

  it('rejects invalid stale-dispatch thresholds and remains service-role only', () => {
    expect(hardening).toMatch(/p_stale_threshold_minutes < 1/);
    expect(hardening).toMatch(/p_stale_threshold_minutes > 10080/);
    expect(hardening).toMatch(/ERRCODE = '22023'/);
    expect(hardening).toMatch(/REVOKE ALL ON FUNCTION public\.nvx_cleanup_stale_dispatch_ledger\(integer\)[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(hardening).toMatch(/GRANT EXECUTE ON FUNCTION public\.nvx_cleanup_stale_dispatch_ledger\(integer\)[\s\S]*TO service_role/);
  });

  it('uses typed interval construction rather than concatenating arbitrary interval text', () => {
    expect(hardening).toMatch(/pg_catalog\.make_interval\(mins => p_stale_threshold_minutes\)/);
    expect(hardening).not.toMatch(/p_stale_threshold_minutes \|\| ' minutes'/);
  });
});
