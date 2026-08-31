import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('Attribution health dashboard placement', () => {
  it('keeps HubSpot and attribution controls visible before the operations overview', () => {
    const dashboard = read('../src/pages/Dashboard.tsx')
    const hubspot = dashboard.indexOf('<HubSpotMarketingContactMonitor />')
    const attribution = dashboard.indexOf('<AttributionHealthMonitor />')
    const operations = dashboard.indexOf('<OperationsOverview />')
    expect(hubspot).toBeGreaterThan(-1)
    expect(attribution).toBeGreaterThan(hubspot)
    expect(operations).toBeGreaterThan(attribution)
  })
})
