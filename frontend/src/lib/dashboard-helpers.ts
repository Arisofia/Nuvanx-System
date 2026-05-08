import type { DashboardMetrics } from '../types'

export interface CombinedMetrics {
  metaEstimatedLeads: number
  verifiedRevenue: number
  metaCpl: number | null
  revenuePerLead: number | null
}

export interface RealFunnel {
  metaSpend: number
  metaLeads: number
  crmLeads: number
  doctoraliaRevenue: number
  doctoraliaPatients: number
  cac: number
  cacConfidence: number | string
}

export interface DashboardQuality {
  overallMode: string
  metaDataSource: string
  metaIsReal: boolean
  crmIsReal: boolean
  doctoraliaIsReal: boolean
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
}

export const EMPTY_FUNNEL: RealFunnel = {
  metaSpend: 0,
  metaLeads: 0,
  crmLeads: 0,
  doctoraliaRevenue: 0,
  doctoraliaPatients: 0,
  cac: 0,
  cacConfidence: 0
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
    ? Number(campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.spend ?? 0), 0))
    : Number(insightsSummary.spend)

  const avgCpcRaw = insightsSummary?.cpc == null
    ? Number(
        campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.cpc ?? 0), 0) /
          Math.max(campaigns.filter((c: any) => Number(c.insights?.cpc ?? 0) > 0).length, 1),
      )
    : Number(insightsSummary.cpc)

  const metaConversions = insightsSummary?.conversions == null
    ? campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.conversions ?? 0), 0)
    : Number(insightsSummary.conversions)

  return { spend, avgCpcRaw, metaConversions }
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
  if (Array.isArray(insightsResponse?.daily)) return true
  return campaigns.some((campaign: any) => campaign?.insights?.spend != null)
}

export function calculateRatio(numerator: number, denominator: number) {
  return denominator > 0 ? Number.parseFloat((numerator / denominator).toFixed(2)) : null
}

export function hasMultiAccountKpis(kpisResponse: any) {
  return Array.isArray(kpisResponse?.meta?.accountIds) && kpisResponse.meta.accountIds.length > 1
}

export function buildDashboardState(options: DashboardStateOptions) {
  const {
    metricsData, campaigns, insightsResponse, kpisResponse,
    spend, avgCpcRaw, metaConversions, spendDelta,
  } = options

  const rawKpisMetaSpend = kpisResponse?.meta?.spend
  const canonicalMetaSpend = hasFiniteMetric(rawKpisMetaSpend) && (hasMultiAccountKpis(kpisResponse) || !hasCanonicalInsightsSpend(insightsResponse, campaigns))
    ? Number(rawKpisMetaSpend)
    : spend
  const canonicalMetaLeads = Number(kpisResponse?.meta?.leads ?? metaConversions)
  const doctoraliaPatients = Number(kpisResponse?.doctoralia?.newVerifiedPatients ?? 0)
  const doctoraliaVerifiedRevenue = Number(kpisResponse?.doctoralia?.verifiedRevenue ?? Number(metricsData.verifiedRevenue ?? 0))
  const metaCpl = calculateRatio(canonicalMetaSpend, canonicalMetaLeads)
  const cacDoctoralia = calculateRatio(canonicalMetaSpend, doctoraliaPatients)

  return {
    metrics: {
      totalLeads: Number(metricsData.totalLeads ?? 0),
      conversionRate: Number(metricsData.conversionRate ?? 0),
      patientMatches: Number(metricsData.patientMatches ?? 0),
      patientConversionRate: Number(metricsData.patientConversionRate ?? 0),
      verifiedRevenue: Number(metricsData.verifiedRevenue ?? 0),
      totalRevenue: Number(metricsData.totalRevenue ?? 0),
      settledCount: Number(metricsData.settledCount ?? 0),
      activeCampaigns: campaigns.filter((c: any) => c.status === 'ACTIVE').length,
      spend: canonicalMetaSpend,
      averageCpc: Number.isFinite(avgCpcRaw) ? Number.parseFloat(avgCpcRaw.toFixed(2)) : 0,
      metaConversions: canonicalMetaLeads,
      deltas: {
        leads: metricsData.deltas?.leads ?? null,
        revenue: metricsData.deltas?.revenue ?? null,
        conversions: metricsData.deltas?.conversions ?? null,
        patientMatches: metricsData.deltas?.patientMatches ?? null,
        spend: Number.isFinite(Number(spendDelta)) ? Number(spendDelta) : null,
      },
      loading: false,
      error: null,
      metaError: null,
    },
    combined: {
      metaEstimatedLeads: canonicalMetaLeads,
      verifiedRevenue: doctoraliaVerifiedRevenue,
      metaCpl,
      revenuePerLead: kpisResponse?.doctoralia?.newVerifiedPatients > 0
        ? Number.parseFloat(((kpisResponse?.doctoralia?.verifiedRevenue ?? 0) / kpisResponse.doctoralia.newVerifiedPatients).toFixed(2))
        : null,
    },
    funnel: {
      metaSpend: canonicalMetaSpend,
      metaLeads: canonicalMetaLeads,
      crmLeads: Number(kpisResponse?.crm?.totalLeads ?? Number(metricsData.totalLeads ?? 0)),
      doctoraliaRevenue: doctoraliaVerifiedRevenue,
      doctoraliaPatients,
      cac: cacDoctoralia ?? 0,
      cacConfidence: kpisResponse?.doctoralia?.cac_confidence ?? 0,
    },
    quality: {
      overallMode: kpisResponse?.data_quality?.overall_mode,
      metaDataSource: kpisResponse?.meta?.data_source,
      metaIsReal: kpisResponse?.meta?.is_real,
      crmIsReal: kpisResponse?.crm?.is_real,
      doctoraliaIsReal: kpisResponse?.doctoralia?.is_real,
      metaAccountIds: Array.isArray(kpisResponse?.meta?.accountIds) ? kpisResponse.meta.accountIds : [],
    }
  }
}
