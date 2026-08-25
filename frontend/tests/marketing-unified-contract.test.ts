import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('Control Centre marketing contract', () => {
  it('routes Marketing through the unified Meta + Google Ads surface', () => {
    const app = read('../src/App.tsx')
    expect(app).toContain("import('./pages/MarketingUnified')")
    expect(app).not.toContain("import('./pages/Playbooks')")
    expect(app).not.toContain("import('./pages/SalesPlaybook')")
    expect(app).not.toContain("location === '/playbooks'")
    expect(app).not.toContain("location === '/sales-playbook'")
  })

  it('loads Google Ads insights and campaigns from the canonical API', () => {
    const marketing = read('../src/pages/MarketingUnified.tsx')
    expect(marketing).toContain('/api/google-ads/insights?')
    expect(marketing).toContain('/api/google-ads/campaigns?')
    expect(marketing).toContain('/api/google-ads/status')
    expect(marketing).toContain('google-ads-connection-status')
    expect(marketing).toContain('Conexión Google Ads operativa')
    expect(marketing).toContain('Meta Ads')
    expect(marketing).toContain('Google Ads')
    expect(marketing).toContain('Campañas Google Ads')
    expect(marketing).toContain('Conversiones')
    expect(marketing).toContain('CPC promedio')
  })

  it('prevents stale range responses and timezone-dependent month starts', () => {
    const marketing = read('../src/pages/MarketingUnified.tsx')
    expect(marketing).toContain('requestSequenceRef')
    expect(marketing).toContain('requestSequence !== requestSequenceRef.current')
    expect(marketing).toContain('firstDayOfCurrentMonth')
    expect(marketing).toContain("String(now.getMonth() + 1).padStart(2, '0')")
    expect(marketing).not.toContain('new Date(now.getFullYear(), now.getMonth(), 1).toISOString()')
  })

  it('does not claim an unverified currency or unbounded campaign totals', () => {
    const marketing = read('../src/pages/MarketingUnified.tsx')
    expect(marketing).not.toContain("currency: 'EUR'")
    expect(marketing).toContain('moneda configurada en la cuenta de Google Ads')
    expect(marketing).toContain('Campañas activas cargadas')
    expect(marketing).toContain('máximo 50 por consulta')
  })

  it('shows CPP only when conversions exist', () => {
    const marketing = read('../src/pages/MarketingUnified.tsx')
    expect(marketing).toContain('hasSummaryConversions')
    expect(marketing).toContain('campaign.insights.conversions > 0')
  })
})
