import type { DashboardMetrics } from '../types'

export interface CombinedMetrics {
  metaEstimatedLeads: number
  verifiedRevenue: number
  metaCpl: number | null
  revenuePerLead: number | null
  avgTicketPerMatchedPatient: number | null
}

export interface RealFunnel {
  metaSpend: number | null
  metaLeads: number | null
  crmLeads: number | null
  doctoraliaRevenue: number | null
  doctoraliaPatients: number | null
  cac: number | null
  cacConfidence: number | null
}

export interface DashboardQuality {
  overallMode: string
  metaDataSource: string
  metaIsReal: boolean
  crmIsReal: boolean
  doctoraliaIsReal: boolean
  doctoraliaMatchingIsReal: boolean
  metaAccountIds?: string[]
}

export interface DashboardStateOptions {
  metricsData: any
  campaigns: any[]
  insightsResponse: any
  kpisResponse: any
  spend: number
  avgCpcRaw: number
  metaConversions: number
  spendDelta: number | null
}

export const EMPTY_COMBINED_METRICS: CombinedMetrics = {
  metaEstimatedLeads: 0,
  verifiedRevenue: 0,
  metaCpl: null,
  revenuePerLead: null,
  avgTicketPerMatchedPatient: null,
}

export const EMPTY_FUNNEL: RealFunnel = {
  metaSpend: 0,
  metaLeads: 0,
  crmLeads: 0,
  doctoraliaRevenue: 0,
  doctoraliaPatients: 0,
  cac: 0,
  cacConfidence: 0,
}

function pick(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function toNullableNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return Boolean(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(String).filter(Boolean)
}

function toSafeLabel(value: unknown, fallback = 'unknown') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value))
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    const numeric = Number(normalized)
    if (Number.isFinite(numeric)) return Math.max(0, Math.min(100, numeric))
    if (normalized === 'high') return 90
    if (normalized === 'medium') return 60
    if (normalized === 'low') return 25
  }
  return null
}

function resolveOverallMode(params: {
  apiOverallMode: unknown
  metaIsReal: boolean
  crmIsReal: boolean
  doctoraliaIsReal: boolean
}) {
  const { apiOverallMode, metaIsReal, crmIsReal, doctoraliaIsReal } = params
  const calculated = (() => {
    if (metaIsReal && crmIsReal && doctoraliaIsReal) return 'full_real'
    if (metaIsReal || crmIsReal || doctoraliaIsReal) return 'partial_demo'
    return 'full_demo'
  })()

  const apiMode = toSafeLabel(apiOverallMode, calculated)
  if (apiMode === 'full_demo' && calculated !== 'full_demo') return calculated
  if (apiMode === 'full_real' && calculated !== 'full_real') return calculated
  return apiMode
}

export function buildDashboardPaths(isCustomRange: boolean, customFrom: string, customTo: string, days: number) {
  const baseParams = isCustomRange ? `?from=${customFrom}&to=${customTo}` : `?days=${days}`
  const campaignsPath = isCustomRange ? `?from=${customFrom}&to=${customTo}` : `?days=${days}`
  return {
    baseParams,
    campaignsPath,
  }
}

export function resolveInsightsTotals(insightsSummary: any, campaigns: any[]) {
  const spend = insightsSummary?.spend == null
    ? Number(campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.spend ?? 0), 0))
    : Number(insightsSummary.spend)

  const campaignsWithCpc = campaigns.filter((campaign: any) => Number(campaign.insights?.cpc ?? 0) > 0)
  const avgCpcRaw = insightsSummary?.cpc == null
    ? Number(
        campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.cpc ?? 0), 0) /
          Math.max(campaignsWithCpc.length, 1),
      )
    : Number(insightsSummary.cpc)

  const metaConversions = insightsSummary?.conversions == null
    ? campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.conversions ?? 0), 0)
    : Number(insightsSummary.conversions)

  return {
    spend: Number.isFinite(spend) ? spend : 0,
    avgCpcRaw: Number.isFinite(avgCpcRaw) ? avgCpcRaw : 0,
    metaConversions: Number.isFinite(metaConversions) ? metaConversions : 0,
  }
}

export function buildMetaFailureMessage(campaignsResult: PromiseSettledResult<any>, insightsResult: PromiseSettledResult<any>) {
  if (campaignsResult.status === 'rejected' || insightsResult.status === 'rejected') {
    return (campaignsResult as any).reason?.message || (insightsResult as any).reason?.message || 'Meta API unavailable'
  }
  return null
}

export function formatDateForLabel(dateString: string) {
  const [year, month, day] = dateString.split('-')
  if (!year || !month || !day) return dateString
  return `${day}/${month}/${year}`
}

export function hasFiniteMetric(value: unknown) {
  return Number.isFinite(Number(value))
}

export function hasCanonicalInsightsSpend(insightsResponse: any, campaigns: any[]) {
  if (insightsResponse?.summary?.spend != null) return true
  if (Array.isArray(insightsResponse?.daily) && insightsResponse.daily.length > 0) return true
  return campaigns.some((campaign: any) => campaign?.insights?.spend != null)
}

export function calculateRatio(numerator: number, denominator: number) {
  return denominator > 0 ? Number.parseFloat((numerator / denominator).toFixed(2)) : null
}

export function hasMultiAccountKpis(kpisResponse: any) {
  const meta = asObject(kpisResponse?.meta)
  const accountIds = pick(meta.accountIds, meta.account_ids)
  return Array.isArray(accountIds) && accountIds.length > 1
}

export function buildDashboardState(options: DashboardStateOptions) {
  const {
    metricsData,
    campaigns,
    insightsResponse,
    kpisResponse,
    spend,
    avgCpcRaw,
    metaConversions,
    spendDelta,
  } = options

  const kpisMeta = asObject(kpisResponse?.meta)
  const kpisCrm = asObject(kpisResponse?.crm)
  const kpisDoctoralia = asObject(kpisResponse?.doctoralia)
  const kpisDataQuality = asObject(kpisResponse?.data_quality)

  const rawKpisMetaSpend = pick(
    kpisMeta.spend,
    kpisMeta.totalSpend,
    kpisMeta.total_spend,
    metricsData.spend,
  )

  const rawKpisMetaLeads = pick(
    kpisMeta.leads,
    kpisMeta.conversions,
    kpisMeta.metaConversions,
    kpisMeta.meta_conversions,
    metricsData.metaConversions,
    metricsData.meta_conversions,
    metaConversions,
  )

  const canonicalMetaSpend = hasFiniteMetric(rawKpisMetaSpend) &&
    (hasMultiAccountKpis(kpisResponse) || !hasCanonicalInsightsSpend(insightsResponse, campaigns))
    ? Number(rawKpisMetaSpend)
    : toNumber(spend)

  const canonicalMetaLeads = toNumber(rawKpisMetaLeads)

  const canonicalAvgCpc = Number.isFinite(Number(avgCpcRaw)) && Number(avgCpcRaw) > 0
    ? Number.parseFloat(Number(avgCpcRaw).toFixed(2))
    : calculateRatio(canonicalMetaSpend, canonicalMetaLeads)

  const doctoraliaPatients = toNumber(pick(
    kpisDoctoralia.newVerifiedPatients,
    kpisDoctoralia.new_verified_patients,
    kpisDoctoralia.patientMatches,
    kpisDoctoralia.patient_matches,
    metricsData.patientMatches,
    metricsData.patient_matches,
  ))

  const doctoraliaVerifiedRevenue = toNumber(pick(
    kpisDoctoralia.verifiedRevenue,
    kpisDoctoralia.verified_revenue,
    metricsData.verifiedRevenue,
    metricsData.verified_revenue,
  ))

  const totalLeads = toNullableNumber(pick(
    metricsData.totalLeads,
    metricsData.total_leads,
    kpisCrm.totalLeads,
    kpisCrm.total_leads,
  ))

  const conversionRate = toNullableNumber(pick(
    metricsData.conversionRate,
    metricsData.conversion_rate,
    kpisCrm.conversionRate,
    kpisCrm.conversion_rate,
  ))

  const patientConversionRate = toNullableNumber(pick(
    metricsData.patientConversionRate,
    metricsData.patient_conversion_rate,
    kpisDoctoralia.patientConversionRate,
    kpisDoctoralia.patient_conversion_rate,
  ))

  const totalRevenue = toNullableNumber(pick(
    metricsData.totalRevenue,
    metricsData.total_revenue,
    kpisDoctoralia.totalRevenue,
    kpisDoctoralia.total_revenue,
  ))

  const settledCount = toNullableNumber(pick(
    metricsData.settledCount,
    metricsData.settled_count,
    kpisDoctoralia.settledCount,
    kpisDoctoralia.settled_count,
    kpisDoctoralia.total_settlements,
    kpisDoctoralia.totalSettlements,
  ))

  const metaCpl = calculateRatio(canonicalMetaSpend, canonicalMetaLeads)
  const cacDoctoralia = calculateRatio(canonicalMetaSpend, doctoraliaPatients)
  const revenuePerLead = calculateRatio(doctoraliaVerifiedRevenue, totalLeads ?? 0)
  const avgTicketPerMatchedPatient = calculateRatio(doctoraliaVerifiedRevenue, doctoraliaPatients)

  const accountIds = pick(kpisMeta.accountIds, kpisMeta.account_ids)

  const deltas = asObject(metricsData.deltas)

  const metaIsReal = toBoolean(pick(kpisMeta.is_real, kpisMeta.isReal)) || canonicalMetaSpend > 0 || canonicalMetaLeads > 0
  const crmIsReal = toBoolean(pick(kpisCrm.is_real, kpisCrm.isReal)) || Number(totalLeads ?? 0) > 0
  const doctoraliaIsReal = toBoolean(pick(kpisDoctoralia.is_real, kpisDoctoralia.isReal)) || doctoraliaVerifiedRevenue > 0 || Number(settledCount ?? 0) > 0
  const doctoraliaMatchingIsReal = toBoolean(pick(
    kpisDataQuality.doctoralia_matching_real,
    kpisDataQuality.doctoraliaMatchingReal,
  )) || doctoraliaPatients > 0
  const overallMode = resolveOverallMode({
    apiOverallMode: pick(kpisDataQuality.overall_mode, kpisDataQuality.overallMode),
    metaIsReal,
    crmIsReal,
    doctoraliaIsReal,
  })

  return {
    metrics: {
      totalLeads,
      conversionRate,
      patientMatches: doctoraliaPatients,
      patientConversionRate,
      verifiedRevenue: toNullableNumber(doctoraliaVerifiedRevenue),
      totalRevenue,
      settledCount,
      activeCampaigns: campaigns.filter((campaign: any) => campaign.status === 'ACTIVE').length,
      spend: canonicalMetaSpend,
      averageCpc: canonicalAvgCpc,
      metaConversions: canonicalMetaLeads,
      deltas: {
        leads: toNullableNumber(pick(deltas.leads, deltas.totalLeads, deltas.total_leads)),
        revenue: toNullableNumber(pick(deltas.revenue, deltas.verifiedRevenue, deltas.verified_revenue)),
        conversions: toNullableNumber(pick(deltas.conversions, deltas.metaConversions, deltas.meta_conversions)),
        patientMatches: toNullableNumber(pick(deltas.patientMatches, deltas.patient_matches)),
        spend: toNullableNumber(spendDelta),
      },
      loading: false,
      error: null,
      metaError: null,
    } satisfies DashboardMetrics,

    combined: {
      metaEstimatedLeads: canonicalMetaLeads,
      verifiedRevenue: doctoraliaVerifiedRevenue,
      metaCpl,
      revenuePerLead,
      avgTicketPerMatchedPatient,
    } satisfies CombinedMetrics,

    funnel: {
      metaSpend: canonicalMetaSpend,
      metaLeads: canonicalMetaLeads,
      crmLeads: totalLeads,
      doctoraliaRevenue: doctoraliaVerifiedRevenue,
      doctoraliaPatients,
      cac: cacDoctoralia,
      cacConfidence: normalizeConfidence(pick(
        kpisDoctoralia.cac_confidence,
        kpisDoctoralia.cacConfidence,
        metricsData.cac_confidence,
        metricsData.cacConfidence,
      )),
    } satisfies RealFunnel,
    quality: {
      overallMode,
      metaDataSource: toSafeLabel(pick(kpisMeta.data_source, kpisMeta.dataSource)),
      metaIsReal,
      crmIsReal,
      doctoraliaIsReal,
      doctoraliaMatchingIsReal,
      metaAccountIds: toStringArray(accountIds),
    } satisfies DashboardQuality,
  }
}
