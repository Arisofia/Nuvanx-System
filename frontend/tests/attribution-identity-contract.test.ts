import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('Attribution Identity v1', () => {
  it('purges only the known unapplied QA Google ledger and keeps cleanup deterministic', () => {
    const migration = read('../../supabase/migrations/20260831031258_canonical_attribution_identity_and_qa_cleanup.sql')
    expect(migration).toContain("IF v_count <> 14 THEN")
    expect(migration).toContain("landing_url LIKE 'https://staging2.nuvanx.com/%'")
    expect(migration).toContain("gclid LIKE 'NVXALLOW-%'")
    expect(migration).toContain("gclid LIKE 'NUVANX_QA_%'")
    expect(migration).toContain('applied_lead_id IS NULL')
    expect(migration).toContain("reconciliation_status = 'pending'")
  })

  it('makes final reconciliation the single fill-null owner for acquisition identity', () => {
    const migration = read('../../supabase/migrations/20260831031258_canonical_attribution_identity_and_qa_cleanup.sql')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.finalize_web_capture_reconciliation')
    expect(migration).toContain("v_capture.conversion_attribution ->> 'fbc'")
    expect(migration).toContain("v_capture.conversion_attribution ->> 'fbp'")
    expect(migration).toContain("gclid = COALESCE(NULLIF(BTRIM(gclid), ''), v_gclid)")
    expect(migration).toContain("fbc = COALESCE(NULLIF(BTRIM(fbc), ''), v_fbc)")
    expect(migration).toContain("fbp = COALESCE(NULLIF(BTRIM(fbp), ''), v_fbp)")
    expect(migration).not.toContain("stage = 'convertido'")
    expect(migration).not.toContain('verified_revenue =')
  })

  it('accepts Meta browser identity only inside the consent-gated capture payload', () => {
    const capture = read('../../supabase/functions/lead-captured/index.ts')
    expect(capture).toContain('"fbclid", "fbc", "fbp"')
    expect(capture).toContain('marketingConsent ? cleanAttribution(body.first_attribution) : {}')
    expect(capture).toContain('marketingConsent ? cleanAttribution(body.conversion_attribution) : {}')
    expect(capture).toContain('if (out.fbclid && !out.fbc && out.timestamp)')
    expect(capture).toContain('const derived = `fb.1.${Math.trunc(touchMillis)}.${out.fbclid}`')
    expect(capture).toContain('FBP is never synthesized')
    expect(capture).toContain('schema_version: 3')
  })

  it('reconciles FBC and FBP without creating them when marketing consent is absent', () => {
    const reconcile = read('../../supabase/functions/web-lead-reconcile/index.ts')
    expect(reconcile).toContain('fbc: capture.marketing_consent === true ? attrValue(capture, "fbc") : null')
    expect(reconcile).toContain('fbp: capture.marketing_consent === true ? attrValue(capture, "fbp") : null')
    expect(reconcile).toContain('meta_browser_identity: capture.marketing_consent === true')
  })

  it('surfaces a no-PII attribution health contract on the first dashboard page', () => {
    const migration = read('../../supabase/migrations/20260831031258_canonical_attribution_identity_and_qa_cleanup.sql')
    const component = read('../src/components/dashboard/AttributionHealthMonitor.tsx')
    const dashboard = read('../src/pages/Dashboard.tsx')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.nvx_get_attribution_health()')
    expect(migration).toContain("'contract', 'attribution_identity_v1'")
    expect(component).toContain("supabase.rpc('nvx_get_attribution_health')")
    expect(component).toContain('GCLID')
    expect(component).toContain('FBC')
    expect(component).toContain('FBP')
    expect(dashboard.indexOf('<AttributionHealthMonitor />')).toBeGreaterThan(-1)
    expect(dashboard.indexOf('<AttributionHealthMonitor />')).toBeLessThan(dashboard.indexOf('<OperationsOverview />'))
  })
})
