import type { DashboardMetrics, MetaTrendPoint } from '../types'
import type { CombinedMetrics, DashboardQuality, RealFunnel } from './dashboard-helpers'

export interface DashboardPayload<T> {
  readonly data: T
  readonly valid: boolean
  readonly errors: string[]
}

export interface DashboardPayloadBundle {
  readonly metricsData: Record<string, unknown>
  readonly campaigns: Array<Record<string, unknown>>
  readonly trendData: MetaTrendPoint[]
  readonly funnelRows: Array<Record<string, unknown>>
  readonly quality: DashboardQuality | null
}

export interface DashboardViewState {
  readonly metrics: DashboardMetrics
  readonly combined: CombinedMetrics
  readonly funnel: RealFunnel | null
  readonly trendData: MetaTrendPoint[]
  readonly funnelData: Array<Record<string, unknown>>
  readonly quality: DashboardQuality | null
}

export const DASHBOARD_CACHE_TTL_MS = 60_000
export const DASHBOARD_REQUEST_TIMEOUT_MS = 10_000
export const DASHBOARD_REQUEST_RETRIES = 1

export function toSafeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function toSafeNullableNumber(value: unknown) {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function toSafeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : []
}

function pick(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function normalizeMetricsPayload(metricsResponse: Record<string, unknown>): Record<string, unknown> {
  const explicitMetrics = asRecord(metricsResponse.metrics)
  if (Object.keys(explicitMetrics).length > 0) return explicitMetrics

  const leads = asRecord(metricsResponse.leads)
  const meta = asRecord(metricsResponse.meta)
  const doctoralia = asRecord(metricsResponse.doctoralia)
  const summary = asRecord(metricsResponse.summary)
  const revenue = asRecord(metricsResponse.revenue)

  const normalized = {
    totalLeads: pick(
      metricsResponse.totalLeads,
      summary.totalLeads,
      summary.total_leads,
      leads.totalLeads,
      leads.total_leads,
      leads.total,
    ),
    conversionRate: pick(
      metricsResponse.conversionRate,
      summary.conversionRate,
      summary.conversion_rate,
      leads.conversionRate,
      leads.conversion_rate,
    ),
    patientMatches: pick(
      metricsResponse.patientMatches,
      summary.patientMatches,
      summary.patient_matches,
      doctoralia.patientMatches,
      doctoralia.patient_matches,
      doctoralia.newVerifiedPatients,
      doctoralia.new_verified_patients,
    ),
    patientConversionRate: pick(
      metricsResponse.patientConversionRate,
      summary.patientConversionRate,
      summary.patient_conversion_rate,
      doctoralia.patientConversionRate,
      doctoralia.patient_conversion_rate,
    ),
    verifiedRevenue: pick(
      metricsResponse.verifiedRevenue,
      summary.verifiedRevenue,
      summary.verified_revenue,
      revenue.verifiedRevenue,
      revenue.verified_revenue,
      doctoralia.verifiedRevenue,
      doctoralia.verified_revenue,
    ),
    totalRevenue: pick(
      metricsResponse.totalRevenue,
      summary.totalRevenue,
      summary.total_revenue,
      revenue.totalRevenue,
      revenue.total_revenue,
      revenue.total,
    ),
    settledCount: pick(
      metricsResponse.settledCount,
      summary.settledCount,
      summary.settled_count,
      revenue.settledCount,
      revenue.settled_count,
      doctoralia.settledCount,
      doctoralia.settled_count,
    ),
    spend: pick(
      metricsResponse.spend,
      summary.spend,
      meta.spend,
    ),
    metaConversions: pick(
      metricsResponse.metaConversions,
      summary.metaConversions,
      summary.meta_conversions,
      meta.conversions,
      meta.leads,
    ),
    deltas: asRecord(metricsResponse.deltas),
  }

  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined && value !== null),
  )
}

export function normalizeTrendPoint(value: unknown): MetaTrendPoint | null {
  const row = asRecord(value)
  const week = toSafeString(row.date_start) || toSafeString(row.date) || toSafeString(row.week) || '–'
  const amount = toSafeNumber(row.spend ?? row.value, Number.NaN)
  if (!Number.isFinite(amount)) return null
  return { week, value: amount }
}

export function normalizeTrendData(value: unknown): MetaTrendPoint[] {
  return Array.isArray(value) ? value.map(normalizeTrendPoint).filter((item): item is MetaTrendPoint => Boolean(item)) : []
}

export function validateDashboardBundle(input: {
  readonly metricsResponse: unknown
  readonly campaignsResponse: unknown
  readonly metaTrendsResponse: unknown
  readonly funnelResponse: unknown
  readonly kpisResponse: unknown
}): DashboardPayload<DashboardPayloadBundle> {
  const errors: string[] = []
  const metricsResponse = asRecord(input.metricsResponse)
  const campaignsResponse = asRecord(input.campaignsResponse)
  const metaTrendsResponse = asRecord(input.metaTrendsResponse)
  const funnelResponse = asRecord(input.funnelResponse)
  const kpisResponse = asRecord(input.kpisResponse)

  const metricsData = normalizeMetricsPayload(metricsResponse)
  if (Object.keys(metricsData).length === 0 && Object.keys(metricsResponse).length > 0) {
    errors.push('dashboard.metrics payload does not include recognized metrics')
  }

  const campaigns = asRecordArray(campaignsResponse.campaigns)
  if (campaignsResponse.campaigns != null && !Array.isArray(campaignsResponse.campaigns)) {
    errors.push('meta.campaigns payload is not an array')
  }

  const trendData = normalizeTrendData(metaTrendsResponse.trends)
  if (metaTrendsResponse.trends != null && !Array.isArray(metaTrendsResponse.trends)) {
    errors.push('dashboard.meta-trends payload is not an array')
  }

  const funnelRows = asRecordArray(funnelResponse.funnel)
  if (funnelResponse.funnel != null && !Array.isArray(funnelResponse.funnel)) {
    errors.push('dashboard.lead-flow payload is not an array')
  }

  const dataQuality = asRecord(kpisResponse.data_quality)
  const meta = asRecord(kpisResponse.meta)
  const crm = asRecord(kpisResponse.crm)
  const doctoralia = asRecord(kpisResponse.doctoralia)

  return {
    valid: errors.length === 0,
    errors,
    data: {
      metricsData,
      campaigns,
      trendData,
      funnelRows,
      quality: Object.keys(kpisResponse).length > 0
        ? {
            overallMode: toSafeString(dataQuality.overall_mode, 'unknown'),
            metaDataSource: toSafeString(meta.data_source, 'unknown'),
            metaIsReal: Boolean(meta.is_real),
            crmIsReal: Boolean(crm.is_real),
            doctoraliaIsReal: Boolean(doctoralia.is_real),
            metaAccountIds: Array.isArray(meta.accountIds) ? meta.accountIds.map((id) => String(id)) : [],
          }
        : null,
    },
  }
}

export function buildDashboardCacheKey(path: string) {
  return path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`
}

export function isCacheEntryFresh(createdAt: number, ttlMs = DASHBOARD_CACHE_TTL_MS) {
  return Date.now() - createdAt < ttlMs
}

export function getUserFacingDashboardError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'La solicitud tardó demasiado. Inténtalo de nuevo en unos segundos.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'No se pudieron cargar las métricas del dashboard.'
}