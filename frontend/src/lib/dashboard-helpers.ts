import type { DashboardMetrics } from '../types'

export interface CombinedMetrics {
  metaEstimatedLeads: number
  verifiedRevenue: number | null
  metaCpl: number | null
  revenuePerLead: number | null
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
  verifiedRevenue: null,
  metaCpl: null,
  revenuePerLead: null,
}

export const EMPTY_FUNNEL: RealFunnel = {
  metaSpend: 0,
  metaLeads: 0,
  crmLeads: null,
  doctoraliaRevenue: null,
  doctoraliaPatients: null,
  cac: null,
  cacConfidence: null,
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
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function buildDashboardPaths(from: string, to: string) {
  const baseParams = `?from=${from}&to=${to}`
  const campaignsPath = `?from=${from}&to=${to}`
  return { baseParams, campaignsPath }
}

export function resolveInsightsTotals(insightsSummary: any, campaigns: any[]) {
  const spend = insightsSummary?.spend == null
    ? Number(campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.spend ?? 0), 0))
    : Number(insightsSummary.spend)

  const clicks = insightsSummary?.clicks == null
    ? campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.clicks ?? 0), 0)
    : Number(insightsSummary.clicks)
  const avgCpcRaw = insightsSummary?.cpc == null
    ? (clicks > 0 ? spend / clicks : Number.NaN)
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
    return (campaignsResult as any).reason?.message || (insightsResult as any).reason?.message || 'Meta API no disponible'
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

/**
 * Builds only the provider-side Meta baseline. CRM/Doctoralia conversion fields
 * deliberately remain null here and are overlaid exclusively from
 * nvx_get_dashboard_metrics_v2 in Dashboard.tsx. This prevents legacy API/KPI
 * fields such as stage, converted_patient_id or settlement-derived patient counts
 * from becoming a silent fallback when the canonical contract is unavailable.
 */
export function buildDashboardState(options: DashboardStateOptions) {
  const { metricsData, campaigns, insightsResponse, kpisResponse, spend, avgCpcRaw, metaConversions, spendDelta } = options

  const kpisMeta = asObject(kpisResponse?.meta)
  const kpisCrm = asObject(kpisResponse?.crm)
  const kpisDoctoralia = asObject(kpisResponse?.doctoralia)
  const kpisDataQuality = asObject(kpisResponse?.data_quality)

  const rawKpisMetaSpend = pick(kpisMeta.spend, kpisMeta.totalSpend, kpisMeta.total_spend, metricsData.spend)
  const rawKpisMetaLeads = pick(kpisMeta.leads, kpisMeta.conversions, kpisMeta.metaConversions, kpisMeta.meta_conversions, metricsData.metaConversions, metricsData.meta_conversions, metaConversions)

  const hasCanonicalMetaInsights = hasCanonicalInsightsSpend(insightsResponse, campaigns)
  const canonicalMetaSpend = hasCanonicalMetaInsights
    ? toNumber(spend)
    : hasFiniteMetric(rawKpisMetaSpend) ? Number(rawKpisMetaSpend) : 0
  const canonicalMetaLeads = hasCanonicalMetaInsights ? toNumber(metaConversions) : toNumber(rawKpisMetaLeads)
  const canonicalAvgCpc = Number.isFinite(Number(avgCpcRaw)) && Number(avgCpcRaw) >= 0
    ? Number.parseFloat(Number(avgCpcRaw).toFixed(2))
    : null

  const metaCpl = calculateRatio(canonicalMetaSpend, canonicalMetaLeads)
  const accountIds = pick(kpisMeta.accountIds, kpisMeta.account_ids)

  const metaIsReal = toBoolean(pick(kpisMeta.is_real, kpisMeta.isReal))
  const crmIsReal = toBoolean(pick(kpisCrm.is_real, kpisCrm.isReal))
  const doctoraliaIsReal = toBoolean(pick(kpisDoctoralia.is_real, kpisDoctoralia.isReal))

  return {
    metrics: {
      totalLeads: null,
      conversionRate: null,
      patientMatches: null,
      patientConversionRate: null,
      verifiedRevenue: null,
      totalRevenue: null,
      settledCount: null,
      activeCampaigns: campaigns.filter((campaign: any) => campaign.status === 'ACTIVE').length,
      spend: canonicalMetaSpend,
      averageCpc: canonicalAvgCpc,
      metaConversions: canonicalMetaLeads,
      deltas: {
        leads: null,
        revenue: null,
        conversions: null,
        patientMatches: null,
        spend: toNullableNumber(spendDelta),
      },
      loading: false,
      error: null,
      metaError: null,
    } satisfies DashboardMetrics,

    combined: {
      metaEstimatedLeads: canonicalMetaLeads,
      verifiedRevenue: null,
      metaCpl,
      revenuePerLead: null,
    } satisfies CombinedMetrics,

    funnel: {
      metaSpend: canonicalMetaSpend,
      metaLeads: canonicalMetaLeads,
      crmLeads: null,
      doctoraliaRevenue: null,
      doctoraliaPatients: null,
      cac: null,
      cacConfidence: null,
    } satisfies RealFunnel,

    quality: {
      overallMode: toSafeLabel(pick(kpisDataQuality.overall_mode, kpisDataQuality.overallMode)),
      metaDataSource: toSafeLabel(pick(kpisMeta.data_source, kpisMeta.dataSource)),
      metaIsReal,
      crmIsReal,
      doctoraliaIsReal,
      metaAccountIds: toStringArray(accountIds),
    } satisfies DashboardQuality,
  }
}
