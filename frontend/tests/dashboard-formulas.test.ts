import { describe, expect, it } from 'vitest'
import {
  buildDashboardState,
  calculateRatio,
  resolveInsightsTotals,
} from '../src/lib/dashboard-helpers'
import { normalizeFunnelData } from '../src/lib/dashboard-validation'

describe('dashboard formula contracts', () => {
  it('calculates CPC from spend divided by clicks, never conversions', () => {
    const result = resolveInsightsTotals(
      { spend: 251.17, clicks: 1200, conversions: 0 },
      [],
    )
    expect(result.avgCpcRaw).toBeCloseTo(0.2093, 4)
  })

  it('returns no ratio when the denominator is zero', () => {
    expect(calculateRatio(251.17, 0)).toBeNull()
  })

  it('aggregates traceability rows into explicit funnel stages', () => {
    const funnel = normalizeFunnelData([
      { cita_valoracion: '2026-08-03', estado: 'realizada', revenue: 150 },
      { cita_valoracion: '2026-08-04', estado: 'no acude', revenue: 0 },
      { cita_valoracion: null, estado: 'scheduled', revenue: 0 },
    ])
    expect(funnel.map((stage) => stage.count)).toEqual([3, 2, 1, 1, 1])
    expect(funnel[1]?.percentage).toBe(66.7)
    expect(funnel[3]?.label).toBe('Cerrados con caja')
  })

  it('uses CRM leads as the denominator for revenue per lead', () => {
    const result = buildDashboardState({
      metricsData: { totalLeads: 10, conversionRate: 20 },
      campaigns: [],
      insightsResponse: { summary: { spend: 251.17, clicks: 1200, conversions: 5 } },
      kpisResponse: {
        meta: { spend: 251.17, leads: 5, is_real: true },
        crm: { totalLeads: 10, is_real: true },
        doctoralia: { newVerifiedPatients: 2, verifiedRevenue: 500, is_real: true },
      },
      spend: 251.17,
      avgCpcRaw: 0.21,
      metaConversions: 5,
      spendDelta: null,
    })
    expect(result.combined.revenuePerLead).toBe(50)
    expect(result.funnel.cac).toBe(125.58)
  })
})
