import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('Canonical Metrics v2 contract', () => {
  it('preserves the historical May revenue attribution migration for audit only', () => {
    const legacy = read('../../supabase/migrations/20260520211520_reconcile_phone_match_and_revenue_attribution.sql')
    expect(legacy).toContain('SET verified_revenue = sub.total_revenue')
    expect(legacy).toContain('fs.phone_normalized = l.phone_normalized')
  })

  it('quarantines the legacy runtime reconciler and uses canonical journey reporting', () => {
    const migration = read('../../supabase/migrations/20260831004738_canonical_metrics_v2_and_quarantine_legacy_reconciliation.sql')
    expect(migration).toContain('Deprecated compatibility entrypoint')
    expect(migration).toContain('RETURN 0;')
    expect(migration).toContain('JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id')
    expect(migration).toContain('count(DISTINCT id) FILTER (WHERE is_new_client) AS closed')
    expect(migration).toContain("'contract', 'canonical_journey_v2'")
    expect(migration).not.toContain("mr.total_rev > 0 THEN 'convertido'")
  })

  it('replaces unsafe phone/revenue matchers with evidence-only appointment links', () => {
    const migration = read('../../supabase/migrations/20260831005313_harden_legacy_doctoralia_matchers_and_backfill_safe_primary_matches.sql')
    expect(migration).toContain('INSERT INTO public.lead_appointment_matches')
    expect(migration).toContain('di.doctoralia_identity_count = 1')
    expect(migration).toContain('l.active_lead_phone_count = 1')
    expect(migration).toContain('a.appointment_date > l.created_at::date')
    expect(migration).toContain("ARRAY['anulada','anulado','cancelada','cancelado','cancelled','canceled','no acude'")
    expect(migration).not.toContain("SET verified_revenue = rev.total_revenue")
    expect(migration).not.toContain("THEN 'convertido'")
  })

  it('routes the scheduled Doctoralia refresh through the safe matcher', () => {
    const migration = read('../../supabase/migrations/20260831011429_harden_scheduled_doctoralia_refresh_and_meta_campaign_filter.sql')
    expect(migration).toContain('RETURN public.match_leads_to_doctoralia_by_phone(p_user_id);')
    expect(migration).not.toContain('DELETE FROM public.lead_appointment_matches')
    expect(migration).not.toContain('UPDATE public.leads')
    expect(migration).toContain('LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id')
    expect(migration).toContain('COALESCE(ma.campaign_id, p.campaign_id, l.campaign_id)')
  })

  it('renders canonical CRM metrics without reviving legacy CRM fallbacks', () => {
    const hook = read('../src/hooks/useCanonicalDashboardMetrics.ts')
    const dashboard = read('../src/pages/Dashboard.tsx')
    const helpers = read('../src/lib/dashboard-helpers.ts')
    const metricsGrid = read('../src/components/dashboard/MetricsGrid.tsx')
    const roi = read('../src/components/dashboard/RealROISection.tsx')

    expect(hook).toContain("supabase.rpc('nvx_get_dashboard_metrics_v2'")
    expect(hook).toContain("value.contract !== 'canonical_journey_v2'")
    expect(hook).toContain('isRecord(deltas)')
    expect(dashboard).toContain('useCanonicalDashboardMetrics')
    expect(dashboard).toContain('totalLeads: canonical.metrics?.totalLeads ?? null')
    expect(dashboard).toContain('error: metrics.error')
    expect(dashboard).toContain('Las métricas CRM/Doctoralia quedan ocultas')
    expect(helpers).toContain('totalLeads: null')
    expect(helpers).toContain('cac: null')
    expect(helpers).not.toContain('cacDoctoralia')
    expect(metricsGrid).toContain('Conversión a cliente nuevo')
    expect(metricsGrid).toContain('Lead → control programado/completado')
    expect(roi).toContain('CAC cliente nuevo')
    expect(roi).toContain('No disponible · attribution pendiente')
    expect(roi).not.toContain('Coste por paciente cruzado')
  })
})
