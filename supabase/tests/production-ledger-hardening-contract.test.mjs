import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const hardening = fs.readFileSync(
  'supabase/migrations/20260831172000_harden_traceability_tenant_and_dispatch_threshold.sql',
  'utf8',
);

const reconciliation = fs.readFileSync(
  'supabase/migrations/20260831172500_consolidate_revops_dispatch_reconciliation.sql',
  'utf8',
);

const funnelAndSourceRepair = fs.readFileSync(
  'supabase/migrations/20260831173000_repair_funnel_and_source_to_cash_contracts.sql',
  'utf8',
);

const metaDailyRouteHistory = fs.readFileSync(
  'supabase/migrations/20260829235708_route_meta_daily_insights_to_canonical_worker.sql',
  'utf8',
);

const authenticatedRpcRepair = fs.readFileSync(
  'supabase/migrations/20260831185000_restore_control_centre_security_definer.sql',
  'utf8',
);

const migrationRunner = fs.readFileSync('scripts/supabase-migrate.sh', 'utf8');
const productionDeploy = fs.readFileSync('.github/workflows/master.yml', 'utf8');
const doctorsBridge = fs.readFileSync(
  'supabase/migrations/20260830223450_bridge_doctors_table.sql',
  'utf8',
);
const doctorsSeed = fs.readFileSync(
  'supabase/migrations/20260830223500_seed_canonical_doctors.sql',
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
  it('preserves restored applied history except explicitly documented replay-portability repairs', () => {
    expect(staleCleanupHistory).toMatch(/nvx-revops-dispatch-stale-cleanup/);
    expect(traceabilityHistory).toMatch(/JOIN doctoralia_appointments_ingestion dai/);
    expect(hardening).toMatch(/Do not rewrite the already-applied historical migrations/);
    expect(reconciliation).toMatch(/Consolidate RevOps async outcome reconciliation into one canonical owner/);
    expect(funnelAndSourceRepair).toMatch(/Historical migration files remain byte-equivalent to Production audit history/);
  });

  it('routes the historical Meta daily cron by stable jobname instead of a generated job id', () => {
    expect(metaDailyRouteHistory).toMatch(/jobname = 'fetch-meta-daily-insights'/);
    expect(metaDailyRouteHistory).toMatch(/PERFORM cron\.alter_job\([\s\S]*v_job\.jobid/);
    expect(metaDailyRouteHistory).toMatch(/environment-local/);
    expect(metaDailyRouteHistory).not.toMatch(/cron\.alter_job\(\s*26,/);
  });

  it('restores SECURITY DEFINER only on the authenticated RPC surface whose ledger contract drifted', () => {
    const expectedSignatures = [
      'nvx_get_control_centre_pipeline(integer, integer)',
      'nvx_get_control_centre_lead_timeline(uuid, integer)',
      'nvx_set_lead_pipeline_state(uuid, text, text, timestamptz, text)',
      'nvx_get_hubspot_marketing_contact_monitor()',
      'nvx_get_attribution_health()',
      'nvx_get_dashboard_metrics_v2(date, date, text, text)',
    ];

    for (const signature of expectedSignatures) {
      expect(authenticatedRpcRepair).toContain(`ALTER FUNCTION public.${signature}`);
    }
    expect(authenticatedRpcRepair.match(/SECURITY DEFINER/g)?.length).toBe(7); // comment + six ALTERs
    expect(authenticatedRpcRepair).not.toMatch(/GRANT\s+SELECT\s+ON/i);
    expect(authenticatedRpcRepair).toMatch(/FROM PUBLIC, anon/);
    expect(authenticatedRpcRepair).toMatch(/TO authenticated, service_role/);
  });

  it('requires exact tenant resolution before exposing Doctoralia traceability', () => {
    expect(hardening).toMatch(/JOIN public\.clinics c/);
    expect(hardening).toMatch(/c\.name = dai\.clinic/);
    expect(hardening).toMatch(/c\.id = l\.clinic_id/);
    expect(hardening).toMatch(/DISTINCT ON \(leads\.phone_normalized, leads\.clinic_id\)/);
    expect(hardening).toMatch(/ORDER BY leads\.phone_normalized, leads\.clinic_id, leads\.created_at DESC/);
    expect(hardening).not.toMatch(/pi\.clinic_id IS NULL OR/);
  });

  it('creates public.doctors before the already-applied canonical seed on clean Preview history', () => {
    expect(doctorsBridge).toMatch(/CREATE TABLE IF NOT EXISTS public\.doctors/);
    expect(doctorsBridge).toMatch(/ADD COLUMN IF NOT EXISTS clinic_id uuid/);
    expect(doctorsSeed).toMatch(/INSERT INTO public\.doctors/);
    expect(doctorsSeed).not.toMatch(/CREATE TABLE/);
  });

  it('makes the production deploy path use the fail-closed migration runner', () => {
    expect(productionDeploy).toMatch(/bash scripts\/supabase-migrate\.sh/);
    expect(productionDeploy).not.toMatch(
      /Apply canonical migrations[\s\S]*supabase db push --include-all --db-url/,
    );
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
    expect(reconciliation).toMatch(/pg_catalog\.make_interval\(mins => p_lookback_minutes\)/);
  });

  it('terminalizes stale dispatches independently of pg_net retention and never stores raw response content', () => {
    expect(reconciliation).toMatch(/WHERE status = 'dispatched'[\s\S]*dispatched_at < pg_catalog\.now\(\) - INTERVAL '5 minutes'/);
    expect(reconciliation).toMatch(/response_body = NULL/);
    expect(reconciliation).not.toMatch(/r\.content/);
    expect(reconciliation).not.toMatch(/jsonb_build_object\('raw'/);
  });

  it('retires the duplicate stale-cleanup owner and schedules the canonical reconciler by jobname', () => {
    expect(reconciliation).toMatch(/jobname IN \([\s\S]*'nvx-revops-dispatch-stale-cleanup'[\s\S]*'nvx-revops-dispatch-reconcile'/);
    expect(reconciliation).toMatch(/DROP FUNCTION IF EXISTS public\.nvx_cleanup_stale_dispatch_ledger\(integer\)/);
    expect(reconciliation).toMatch(/'nvx-revops-dispatch-reconcile',[\s\S]*'\*\/10 \* \* \* \*'/);
    expect(reconciliation).toMatch(/GRANT EXECUTE ON FUNCTION public\.nvx_reconcile_dispatch_ledger\(integer\)[\s\S]*TO service_role/);
  });

  it('repairs funnel data through the canonical owner rather than duplicating status mapping', () => {
    expect(funnelAndSourceRepair).toMatch(/PERFORM public\.refresh_doctoralia_funnel\(v_user_id\)/);
    expect(funnelAndSourceRepair).toMatch(/lower\(coalesce\(pc\.funnel_status, ''\)\) IN \('converted', 'returning'\)/);
    expect(funnelAndSourceRepair).not.toMatch(/WHEN LOWER\(estado\)/);
  });

  it('keeps source_to_cash dependency-safe, stable and Doctoralia-identifiable', () => {
    expect(funnelAndSourceRepair).toMatch(/CREATE OR REPLACE VIEW public\.source_to_cash/);
    expect(funnelAndSourceRepair).not.toMatch(/DROP VIEW IF EXISTS public\.source_to_cash/);
    expect(funnelAndSourceRepair).toMatch(/dai\.appointment_date DESC NULLS LAST,[\s\S]*dai\.amount DESC NULLS LAST,[\s\S]*dai\.id/);
    expect(funnelAndSourceRepair).toMatch(/NULLIF\(pg_catalog\.btrim\(dai\.doctoralia_id\), ''\)/);
  });

  it('fails closed on migration-history drift and never repairs the remote ledger automatically', () => {
    expect(migrationRunner).toMatch(/db push --dry-run --include-all/);
    expect(migrationRunner).toMatch(/Remote migration versions not found in local migrations directory/);
    expect(migrationRunner).toMatch(/No database mutation was attempted/);
    expect(migrationRunner).not.toMatch(/supabase\s+migration\s+repair/);
  });

  it('retries only recognized transport failures', () => {
    expect(migrationRunner).toMatch(/is_transient_transport_error/);
    expect(migrationRunner).toMatch(/DB_PUSH_RETRYABLE=false/);
    expect(migrationRunner).toMatch(/DB_PUSH_RETRYABLE=true/);
    expect(migrationRunner).toMatch(/unclassified reason\. Failing closed/);
    expect(migrationRunner).toMatch(/\$\{DB_PUSH_RETRYABLE:-false\}" != "true"/);
    expect(migrationRunner).toMatch(/max_attempts=3/);
  });
});
