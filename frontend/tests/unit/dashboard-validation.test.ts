import {
  buildDashboardCacheKey,
  getUserFacingDashboardError,
  isCacheEntryFresh,
  normalizeTrendData,
  toSafeNullableNumber,
  toSafeNumber,
  validateDashboardBundle,
} from '../../src/lib/dashboard-validation'

describe('dashboard validation utilities', () => {
  it('coerces numeric values safely', () => {
    expect(toSafeNumber('42.5')).toBe(42.5)
    expect(toSafeNumber('invalid', 7)).toBe(7)
    expect(toSafeNullableNumber('')).toBeNull()
    expect(toSafeNullableNumber('12')).toBe(12)
  })

  it('normalizes trend rows and removes invalid points', () => {
    expect(normalizeTrendData([
      { date_start: '2026-05-01', spend: '100.25' },
      { week: '2026-W19', value: 80 },
      { date: 'bad', spend: 'NaN' },
    ])).toEqual([
      { week: '2026-05-01', value: 100.25 },
      { week: '2026-W19', value: 80 },
    ])
  })

  it('validates dashboard payloads without throwing on malformed optional resources', () => {
    const result = validateDashboardBundle({
      metricsResponse: { metrics: { totalLeads: '5', bySource: { meta: 3 } } },
      campaignsResponse: { campaigns: 'not-array' },
      metaTrendsResponse: { trends: [{ date: '2026-05-01', spend: 12 }] },
      funnelResponse: { funnel: [{ stage: 'lead', count: 5 }] },
      kpisResponse: {
        data_quality: { overall_mode: 'real' },
        meta: { data_source: 'api', is_real: true, accountIds: [123] },
        crm: { is_real: true },
        doctoralia: { is_real: false },
      },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('meta.campaigns payload is not an array')
    expect(result.data.metricsData.totalLeads).toBe('5')
    expect(result.data.trendData).toEqual([{ week: '2026-05-01', value: 12 }])
    expect(result.data.quality?.metaAccountIds).toEqual(['123'])
  })

  it('builds deterministic cache keys and evaluates freshness', () => {
    expect(buildDashboardCacheKey('/dashboard/metrics?days=30')).toBe('/api/dashboard/metrics?days=30')
    expect(buildDashboardCacheKey('/api/dashboard/metrics?days=30')).toBe('/api/dashboard/metrics?days=30')
    expect(isCacheEntryFresh(Date.now(), 1000)).toBe(true)
    expect(isCacheEntryFresh(Date.now() - 2000, 1000)).toBe(false)
  })

  it('returns safe dashboard error messages', () => {
    expect(getUserFacingDashboardError(new Error('HTTP 500'))).toBe('HTTP 500')
    expect(getUserFacingDashboardError(null)).toBe('No se pudieron cargar las métricas del dashboard.')
  })
})
