import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('HubSpot marketing contact monitor contract', () => {
  it('keeps the HubSpot threshold visible at the top of the Control Centre', () => {
    const dashboard = read('../src/pages/Dashboard.tsx')
    const monitorIndex = dashboard.indexOf('<HubSpotMarketingContactMonitor />')
    const operationsIndex = dashboard.indexOf('<OperationsOverview />')

    expect(monitorIndex).toBeGreaterThan(-1)
    expect(operationsIndex).toBeGreaterThan(-1)
    expect(monitorIndex).toBeLessThan(operationsIndex)
  })

  it('reads only the authenticated monitor projection and never the PII archive table', () => {
    const component = read('../src/components/dashboard/HubSpotMarketingContactMonitor.tsx')

    expect(component).toContain("supabase.rpc('nvx_get_hubspot_marketing_contact_monitor')")
    expect(component).toContain('Alerta 900')
    expect(component).not.toContain('hubspot_contacts_archive')
    expect(component).not.toContain('hubspot_contact_import_batches')
  })

  it('keeps the RPC authenticated and read-only', () => {
    const migration = read('../../supabase/migrations/20260830232901_expose_hubspot_marketing_monitor_to_control_centre.sql')

    expect(migration).toContain("if auth.uid() is null then")
    expect(migration).toContain('revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from anon')
    expect(migration).toContain('grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to authenticated')
    expect(migration).not.toContain('email')
    expect(migration).not.toContain('phone')
  })
})
