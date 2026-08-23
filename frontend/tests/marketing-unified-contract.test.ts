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
    expect(marketing).toContain('Meta Ads')
    expect(marketing).toContain('Google Ads')
    expect(marketing).toContain('Campañas Google Ads')
    expect(marketing).toContain('Conversiones')
    expect(marketing).toContain('CPC promedio')
  })
})
