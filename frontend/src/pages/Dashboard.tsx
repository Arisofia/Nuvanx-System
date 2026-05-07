import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import DataModeBadge from '../components/ui/DataModeBadge'
import { TrendingUp, Users, AlertCircle, DollarSign, ArrowUpRight, Percent, Target } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { invokeApi, supabase, supabaseKey, supabaseUrl } from '../lib/supabaseClient'
import type { DashboardMetrics, MetaTrendPoint, ActivityEvent } from '../types'

import { MetricDelta } from '../components/dashboard/MetricDelta'
import { FunnelChart } from '../components/dashboard/FunnelChart'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'
import { resolveMetaAccountIds } from '../config/metaAccounts'

interface CombinedMetrics {
  metaEstimatedLeads: number
  verifiedRevenue: number
  metaCpl: number | null
  revenuePerLead: number | null
}

interface RealFunnel {
  metaSpend: number
  metaLeads: number
  crmLeads: number
  doctoraliaRevenue: number
  doctoraliaPatients: number
  cac: number
  cacConfidence: number | string
}

interface DashboardQuality {
  overallMode: string
  metaDataSource: string
  metaIsReal: boolean
  crmIsReal: boolean
  doctoraliaIsReal: boolean
  metaAccountIds?: string[]
}

const EMPTY_COMBINED_METRICS: CombinedMetrics = {
  metaEstimatedLeads: 0,
  verifiedRevenue: 0,
  metaCpl: null,
  revenuePerLead: null,
}

const EMPTY_FUNNEL: RealFunnel = {
  metaSpend: 0,
  metaLeads: 0,
  crmLeads: 0,
  doctoraliaRevenue: 0,
  doctoraliaPatients: 0,
  cac: 0,
}

const defaultTrend: MetaTrendPoint[] = []

function buildDashboardPaths(isCustomRange: boolean, customFrom: string, customTo: string, days: number) {
  const baseParams = isCustomRange ? `?from=${customFrom}&to=${customTo}` : `?days=${days}`
  const campaignsPath = isCustomRange ? `?from=${customFrom}&to=${customTo}` : `?days=${days}`
  return {
    baseParams,
    campaignsPath,
  }
}

function resolveInsightsTotals(insightsSummary: any, campaigns: any[]) {
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

function buildMetaFailureMessage(campaignsResult: PromiseSettledResult<any>, insightsResult: PromiseSettledResult<any>) {
  if (campaignsResult.status === 'rejected' || insightsResult.status === 'rejected') {
    return (campaignsResult as any).reason?.message || (insightsResult as any).reason?.message || 'Meta API unavailable'
  }
  return null
}

function formatDateForLabel(dateString: string) {
  const [year, month, day] = dateString.split('-')
  if (!year || !month || !day) return dateString
  return `${day}/${month}/${year}`
}

interface DashboardStateOptions {
  metricsData: any
  campaigns: any[]
  insightsResponse: any
  kpisResponse: any
  spend: number
  avgCpcRaw: number
  metaConversions: number
  spendDelta: number
}

function hasFiniteMetric(value: unknown) {
  return Number.isFinite(Number(value))
}

function hasCanonicalInsightsSpend(insightsResponse: any, campaigns: any[]) {
  if (insightsResponse?.summary?.spend != null) return true
  if (Array.isArray(insightsResponse?.daily)) return true
  return campaigns.some((campaign: any) => campaign?.insights?.spend != null)
}

function calculateRatio(numerator: number, denominator: number) {
  return denominator > 0 ? Number.parseFloat((numerator / denominator).toFixed(2)) : null
}

function hasMultiAccountKpis(kpisResponse: any) {
  return Array.isArray(kpisResponse?.meta?.accountIds) && kpisResponse.meta.accountIds.length > 1
}

function buildDashboardState(options: DashboardStateOptions) {
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
        leads: metricsData.deltas?.leads ?? 0,
        revenue: metricsData.deltas?.revenue ?? 0,
        conversions: metricsData.deltas?.conversions ?? 0,
        patientMatches: metricsData.deltas?.patientMatches ?? 0,
        spend: Number(spendDelta),
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

function useDashboardData(
  days: number,
  customFrom: string,
  customTo: string,
  campaignId: string,
  sourceFilter: string,
  campaignsCount: number,
  sourcesCount: number,
) {
  const [funnelData, setFunnelData] = useState<any[]>([])
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalLeads: 0,
    conversionRate: 0,
    activeCampaigns: 0,
    spend: 0,
    averageCpc: 0,
    metaConversions: 0,
    loading: true,
    error: null,
    metaError: null,
  })
  const [combined, setCombined] = useState<CombinedMetrics>(EMPTY_COMBINED_METRICS)
  const [funnel, setFunnel] = useState<RealFunnel | null>(null)
  const [quality, setQuality] = useState<any>(null)
  const [isFunnelDemo, setIsFunnelDemo] = useState<boolean>(false)
  const [dataMode, setDataMode] = useState<string | undefined>(undefined)
  const [trendData, setTrendData] = useState<MetaTrendPoint[]>([])
  const [sourcesList, setSourcesList] = useState<string[]>([])
  const [campaignsList, setCampaignsList] = useState<{ id: string, name: string }[]>([])

  useEffect(() => {
    const buildParams = () => {
      const isCustomRange = Boolean(customFrom && customTo)
      const { baseParams, campaignsPath } = buildDashboardPaths(isCustomRange, customFrom, customTo, days)
      const campaignParam = campaignId === 'ALL' ? '' : `&campaign_id=${campaignId}`
      const sourceParam = sourceFilter === 'ALL' ? '' : `&source=${sourceFilter}`
      const queryParams = `${baseParams}${campaignParam}`
      const dashboardParams = `${queryParams}${sourceParam}`
      return { queryParams, dashboardParams, campaignsPath }
    }

    const processResults = (
      metricsResult: any,
      metaTrendsResult: any,
      campaignsResult: any,
      insightsResult: any,
      funnelResult: any,
      kpisResult: any
    ) => {
      if (metricsResult.status === 'rejected') throw metricsResult.reason
      
      const kpisResponse = kpisResult.status === 'fulfilled' ? kpisResult.value : null
      const metricsData = metricsResult.value?.metrics ?? {}
      if (metricsData.bySource && Object.keys(metricsData.bySource).length > 0 && sourcesCount === 0) {
        setSourcesList(Object.keys(metricsData.bySource))
      }

      if (funnelResult.status === 'fulfilled') {
        setFunnelData(funnelResult.value.funnel || [])
      }

      const campaignsResponse = campaignsResult.status === 'fulfilled' ? campaignsResult.value : null
      const metaTrendsResponse = metaTrendsResult.status === 'fulfilled' ? metaTrendsResult.value : null
      const insightsResponse = insightsResult.status === 'fulfilled' ? insightsResult.value : null

      const metaFailureMessage = buildMetaFailureMessage(campaignsResult, insightsResult)
      const campaigns = Array.isArray(campaignsResponse?.campaigns) ? campaignsResponse.campaigns : []
      if (campaigns.length > 0 && campaignsCount === 0) {
        setCampaignsList(campaigns.map((c: any) => ({ id: c.id, name: c.name })))
      }

      const insightsSummary = insightsResponse?.summary
      const { spend, avgCpcRaw, metaConversions } = resolveInsightsTotals(insightsSummary, campaigns)
      const spendDelta = insightsResponse?.changes?.spend ?? 0

      if (kpisResponse?.success !== true) {
        setIsFunnelDemo(false)
        setTrendData(defaultTrend)
        setCombined(EMPTY_COMBINED_METRICS)
        setFunnel(EMPTY_FUNNEL)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'No real KPI data available. Conecta Meta y Doctoralia para ver datos reales.',
          metaError: null,
        }))
        return
      }

      setIsFunnelDemo((kpisResponse?.doctoralia?.newVerifiedPatients ?? 0) === 0)
      setDataMode(kpisResponse?.data_quality?.overall_mode as string | undefined)
      setTrendData(
        Array.isArray(metaTrendsResponse?.trends)
          ? metaTrendsResponse.trends.map((item: any) => ({
              week: item.date_start ?? item.date ?? '–',
              value: Number(item.spend ?? 0),
            }))
          : [],
      )

      const { metrics: metricsPayload, combined: combinedPayload, funnel: funnelPayload, quality: qualityPayload } = buildDashboardState({
        metricsData,
        campaigns,
        insightsResponse,
        kpisResponse,
        spend,
        avgCpcRaw,
        metaConversions,
        spendDelta,
      })

      setMetrics({ ...metricsPayload, metaError: metaFailureMessage })
      setCombined(combinedPayload)
      setFunnel(funnelPayload)
      setQuality(qualityPayload)
    }

    const fetchMetrics = async () => {
      if (!supabaseUrl || !supabaseKey) {
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'Supabase environment variables are not configured.',
        }))
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setMetrics((prev) => ({ ...prev, loading: false }))
        return
      }

      try {
        const { queryParams, dashboardParams, campaignsPath } = buildParams()
        const [metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult, kpisResult] = await Promise.allSettled([
          invokeApi(`/dashboard/metrics${dashboardParams}`),
          invokeApi(`/dashboard/meta-trends${queryParams}`),
          invokeApi(`/meta/campaigns${campaignsPath}`),
          invokeApi(`/meta/insights${queryParams}`),
          invokeApi('/dashboard/lead-flow'),
          invokeApi(`/kpis${dashboardParams}`),
        ])

        processResults(metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult, kpisResult)
      } catch (err: any) {
        console.error('Dashboard fetch failed:', err)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || 'Unable to load dashboard metrics',
          metaError: null,
        }))
      }
    }

    fetchMetrics()
  }, [days, customFrom, customTo, campaignId, sourceFilter, campaignsCount, sourcesCount])

  return {
    metrics,
    combined,
    funnel,
    funnelData,
    isFunnelDemo,
    dataMode,
    trendData,
    sourcesList,
    campaignsList,
    quality,
  }
}

interface DashboardHeaderProps {
  readonly dataMode: string | undefined
  readonly sourceFilter: string
  readonly setSourceFilter: (v: string) => void
  readonly sourcesList: string[]
  readonly campaignId: string
  readonly setCampaignId: (v: string) => void
  readonly campaignsList: { id: string, name: string }[]
  readonly days: number
  readonly setDays: (v: 7 | 14 | 30 | 90) => void
  readonly customFrom: string
  readonly setCustomFrom: (v: string) => void
  readonly customTo: string
  readonly setCustomTo: (v: string | ((prev: string) => string)) => void
  readonly metaAccountIds: string[]
}

function DashboardHeader({
  dataMode,
  sourceFilter,
  setSourceFilter,
  sourcesList,
  campaignId,
  setCampaignId,
  campaignsList,
  days,
  setDays,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  metaAccountIds,
}: DashboardHeaderProps) {
  const controlTextClass = 'text-[#5C5550] font-bold uppercase'
  const selectClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase tracking-wider px-4 py-2 cursor-pointer'
  const dateInputClass = 'bg-transparent border-none focus:ring-0 text-[10px] font-bold uppercase w-28 text-center'

  return (
    <div className="flex flex-col space-y-8 mb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <h1 className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">Dashboard</h1>
            <DataModeBadge overallMode={dataMode as any} />
          </div>
          <p className={`${controlTextClass} text-xs tracking-wide`}>Control de Rendimiento Médico</p>
          <MetaAccountsInline
            accountIds={metaAccountIds}
            context="Dashboard consolidado de inversión, campañas y leads atribuidos."
            className="max-w-2xl bg-white/60"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/60 backdrop-blur-md p-1.5 rounded-2xl border border-border/40 shadow-sm">
            {([7, 14, 30, 90] as const).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => { setDays(d); setCustomFrom(''); setCustomTo('') }}
                className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${
                  !customFrom && days === d
                    ? 'bg-primary text-white shadow-md'
                    : 'text-[#8E8680] hover:text-primary hover:bg-primary/5'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="w-full flex flex-col lg:flex-row items-center justify-between gap-6 bg-white/40 backdrop-blur-md p-6 rounded-[2rem] border border-border/40 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {(sourcesList.length > 0 || campaignsList.length > 0) && (
            <div className="flex items-center gap-2 bg-white/80 p-1.5 rounded-2xl border border-border/60 shadow-inner">
              {sourcesList.length > 0 && (
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className={selectClass + ' border-r border-border/40'}
                >
                  <option value="ALL">Todas las fuentes</option>
                  {sourcesList.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
              {campaignsList.length > 0 && (
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  className={selectClass}
                >
                  <option value="ALL">Todas las campañas</option>
                  {campaignsList.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 bg-white/80 p-2 rounded-2xl border border-border/60 shadow-inner">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value)
              setCustomTo((prev) => prev || new Date().toISOString().slice(0, 10))
            }}
            className={dateInputClass}
          />
          <span className="text-[#8E8680] text-xs">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className={dateInputClass}
          />
        </div>
      </div>
    </div>
  )
}

interface AlertSectionProps {
  readonly error: string | null
  readonly metaError: string | null
}

function AlertSection({ error, metaError }: AlertSectionProps) {
  if (!error && !metaError) return null

  return (
    <>
      {error && (
        <div className="alert-card alert-error">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Error de conexión</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {metaError && !error && (
        <div className="alert-card alert-warning">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Error de Meta API</p>
            <p className="text-sm mt-1">
              {metaError.includes('#200') || metaError.includes('permission')
                ? 'Tu token de Meta puede necesitar permisos ads_management o ads_read, o appsecret_proof. Reconecta tu cuenta en Integraciones para corregirlo.'
                : metaError}
            </p>
            <a
              href="/integrations"
              className="inline-block mt-2 text-sm font-medium text-primary underline hover:text-accent"
            >
              Ir a Integraciones →
            </a>
          </div>
        </div>
      )}
    </>
  )
}

interface MetricsGridProps {
  readonly metrics: DashboardMetrics
  readonly quality: DashboardQuality | null
}

function MetricsGrid({ metrics, quality }: MetricsGridProps) {
  const renderIsReal = (isReal: boolean | undefined) => {
    if (isReal === undefined) return null;
    return (
      <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-widest ${isReal ? 'text-green-600 border-green-600/20 bg-green-500/5' : 'text-amber-600 border-amber-600/20 bg-amber-500/5'}`}>
        {isReal ? 'Real' : 'Parcial'}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Meta Performance</CardTitle>
            {renderIsReal(quality?.metaIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <Users className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mt-4">
            <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {metrics.metaConversions.toLocaleString('es-ES')}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.conversions} />}
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Leads Atribuidos</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">CRM Pipeline</CardTitle>
            {renderIsReal(quality?.crmIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <Target className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mt-4">
            <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {metrics.totalLeads.toLocaleString('es-ES')}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.leads} />}
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Leads en BD</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Ingresos Reales</CardTitle>
            {renderIsReal(quality?.doctoraliaIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <DollarSign className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3 mt-4">
            <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              €{metrics.verifiedRevenue.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            {metrics.deltas && <MetricDelta value={metrics.deltas.revenue} />}
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Doctoralia Verificado</p>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 group border-none shadow-sm bg-white">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Tasa de Cierre</CardTitle>
            {renderIsReal(quality?.doctoraliaIsReal)}
          </div>
          <div className="bg-primary/5 p-3 rounded-2xl group-hover:bg-primary/10 transition-colors duration-500">
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-serif font-bold tracking-tight text-[#2C2825] mt-4">
            {metrics.conversionRate.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%
          </div>
          <div className="mt-4">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-wider italic">Lead → Venta</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface FunnelAndSpendSectionProps {
  readonly funnelData: any[]
  readonly metrics: DashboardMetrics
  readonly combined: CombinedMetrics
  readonly periodLabel: string
  readonly funnel: RealFunnel | null
  readonly isFunnelDemo: boolean
  readonly quality: DashboardQuality | null
}

function FunnelAndSpendSection({
  funnelData,
  metrics,
  combined,
  periodLabel,
  funnel,
  isFunnelDemo,
  quality,
}: FunnelAndSpendSectionProps) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-md bg-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl" />
        <CardHeader className="flex flex-row items-center justify-between border-b border-border/10 pb-6 relative">
          <CardTitle className="flex items-center gap-3 font-serif text-2xl text-[#2C2825]">
            <TrendingUp className="h-6 w-6 text-primary" />
            Lead Funnel
          </CardTitle>
          <div className="flex flex-col items-end">
            <p className="text-[10px] text-[#8E8680] font-bold uppercase tracking-widest italic opacity-60">Distribución por etapa</p>
          </div>
        </CardHeader>
        <CardContent className="pt-10">
          <FunnelChart data={funnelData} />
        </CardContent>
      </Card>

      <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-md bg-white overflow-hidden relative">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6 border-b border-border/10">
          <CardTitle className="flex items-center gap-3 font-serif text-2xl text-[#2C2825]">
            <DollarSign className="h-6 w-6 text-primary" />
            Meta Analytics
          </CardTitle>
          {quality?.metaDataSource && (
            <span className="text-[9px] font-bold text-primary/60 uppercase bg-primary/5 px-3 py-1.5 rounded-full border border-primary/10 tracking-[0.2em]">
              {quality.metaDataSource.replace('_', ' ')}
            </span>
          )}
        </CardHeader>
        <CardContent className="pt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Inversión Meta</span>
              <DollarSign className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">€{metrics.spend.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">{periodLabel}</p>
          </div>
          
          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Leads Atribuidos</span>
              <Users className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">{combined.metaEstimatedLeads.toLocaleString('es-ES')}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Meta Leads atribuidos</p>
          </div>

          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">CPL Meta</span>
              <Target className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {combined.metaCpl == null
                ? <span className="text-[#8E8680]">n/a</span>
                : `€${combined.metaCpl.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">
              {combined.metaCpl == null ? 'Sin leads atribuidos en el periodo' : 'Coste por lead atribuido'}
            </p>
          </div>

          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Leads Registrados</span>
              <Target className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">{metrics.totalLeads.toLocaleString('es-ES')}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Total leads en CRM</p>
          </div>

          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Rev. Verificado</span>
              <DollarSign className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">€{combined.verifiedRevenue.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">Confirmado Doctoralia</p>
          </div>

          <div className="bg-[#FAF7F2]/60 p-6 rounded-3xl border border-border/40 hover:border-primary/30 transition-all duration-500 hover:shadow-lg hover:shadow-primary/5 group">
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em] group-hover:text-primary transition-colors">Revenue / Lead</span>
              <ArrowUpRight className="h-4 w-4 text-primary opacity-40 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-4xl font-serif font-bold tracking-tight text-[#2C2825]">
              {combined.revenuePerLead == null
                ? <span className="text-[#8E8680]">n/a</span>
                : `€${combined.revenuePerLead.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </p>
            <div className="h-[1px] w-8 bg-primary/20 my-4" />
            <p className="text-[10px] text-[#8E8680] font-medium italic opacity-60">
              {combined.revenuePerLead == null ? 'Sin pacientes verificados' : 'Ingreso por paciente Doctoralia'}
            </p>
          </div>
        </CardContent>
      </Card>

      {funnel && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2">
              <CardTitle>Embudo real</CardTitle>
              {isFunnelDemo && (
                <p className="text-xs text-[#c9a471]">
                  No hay pacientes Doctoralia verificados en el periodo seleccionado.
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted">Inversión Meta</p>
              <p className="text-lg font-bold">€{funnel.metaSpend.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div>
              <p className="text-muted">Leads generados (Meta)</p>
              <p className="text-lg font-bold">{funnel.metaLeads.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted">Leads registrados en CRM</p>
              <p className="text-lg font-bold">{funnel.crmLeads.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-muted">Ingresos verificados (Doctoralia)</p>
              <p className="text-lg font-bold">€{funnel.doctoraliaRevenue.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className="flex flex-col gap-0.5 mt-1">
                <p className="text-xs text-muted">
                  {funnel.doctoraliaPatients > 0
                    ? `CAC Doctoralia: €${funnel.cac.toLocaleString()}`
                    : 'CAC Doctoralia: n/a (sin pacientes verificados)'}
                </p>
                {funnel.doctoraliaPatients > 0 && (
                  <p className={`text-[10px] font-medium ${funnel.cacConfidence === 'high' || Number(funnel.cacConfidence) > 0.7 ? 'text-green-400' : 'text-amber-400'}`}>
                    Confianza: {typeof funnel.cacConfidence === 'string' ? funnel.cacConfidence : `${Math.round(Number(funnel.cacConfidence) * 100)}%`}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

interface CampaignKpisSectionProps {
  readonly metrics: DashboardMetrics
  readonly trendData: MetaTrendPoint[]
  readonly periodLabel: string
}

function CampaignKpisSection({ metrics, trendData, periodLabel }: CampaignKpisSectionProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.85fr] xl:grid-cols-[1.6fr_0.9fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Meta Spend ({periodLabel})</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#c9a471" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#c9a471" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E2DE" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: '#7A7573', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#7A7573', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E2DE' }} />
                <Area type="monotone" dataKey="value" stroke="#c9a471" fill="url(#trendGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-serif">KPIs de campañas Meta</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted uppercase bg-surface px-2 py-1 rounded-full border border-border tracking-wider">
              Periodo: {periodLabel}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-surface p-4 rounded-2xl border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Inversión</span>
                <DollarSign className="h-3 w-3 text-primary" />
              </div>
              <div className="flex items-baseline gap-1 mt-2">
                <p className="text-xl font-bold tracking-tight">€{metrics.spend.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                {metrics.deltas && <MetricDelta value={metrics.deltas.spend} inverse />}
              </div>
            </div>

            <div className="bg-surface p-4 rounded-2xl border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Revenue</span>
                <DollarSign className="h-3 w-3 text-primary" />
              </div>
              <div className="flex items-baseline gap-1 mt-2">
                <p className="text-xl font-bold tracking-tight">€{(metrics.verifiedRevenue ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                {metrics.deltas && <MetricDelta value={metrics.deltas.revenue} />}
              </div>
              <p className="text-[10px] text-muted font-medium mt-1">{metrics.settledCount ?? 0} liquidados</p>
            </div>

            <div className="bg-surface p-4 rounded-2xl border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Pipeline</span>
                <Target className="h-3 w-3 text-accent" />
              </div>
              <div className="flex items-baseline gap-1 mt-2">
                <p className="text-xl font-bold tracking-tight">€{(metrics.totalRevenue ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
              </div>
              <p className="text-[10px] text-muted font-medium mt-1">Est. leads.revenue</p>
            </div>

            <div className="bg-surface p-4 rounded-2xl border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">CPC medio</span>
                <ArrowUpRight className="h-3 w-3 text-primary" />
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight">€{metrics.averageCpc.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <p className="text-[10px] text-muted font-medium mt-1">Coste por clic</p>
            </div>

            <div className="bg-surface p-4 rounded-2xl border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Conversiones</span>
                <Percent className="h-3 w-3 text-primary" />
              </div>
              <p className="mt-2 text-xl font-bold tracking-tight">{metrics.metaConversions.toLocaleString('es-ES')}</p>
              <p className="text-[10px] text-muted font-medium mt-1">Leads atribuidos</p>
            </div>

            <div className="bg-surface p-4 rounded-2xl border border-border/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-muted uppercase tracking-wider">CAC (Meta)</span>
                <Target className="h-3 w-3 text-danger" />
              </div>
              {metrics.spend > 0 && metrics.metaConversions > 0 ? (
                <p className="mt-2 text-xl font-bold tracking-tight text-danger">
                  €{(metrics.spend / metrics.metaConversions).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </p>
              ) : (
                <p className="mt-2 text-xl font-bold tracking-tight text-muted">—</p>
              )}
              <p className="text-[10px] text-muted font-medium mt-1">spend ÷ leads</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface ActivitySectionProps {
  readonly activity: ActivityEvent[]
}

function ActivitySection({ activity }: ActivitySectionProps) {
  return (
    <Card className="border-none shadow-md bg-white">
      <CardHeader>
        <CardTitle className="font-serif text-xl text-[#2C2825]">Actividad en Tiempo Real</CardTitle>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-[#8E8680] text-sm italic">Esperando eventos de leads vía Supabase Realtime…</p>
        ) : (
          <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
            {activity.map((ev) => (
              <div key={`${ev.ts}-${ev.label}`} className="p-4 bg-[#FAF7F2]/40 rounded-2xl border border-border/30 flex items-center justify-between group hover:border-primary/30 transition-colors">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[#2C2825]">{ev.label}</p>
                  <p className="text-xs text-[#5C5550]">{ev.detail}</p>
                </div>
                <p className="text-[10px] font-bold text-primary uppercase tracking-widest">{new Date(ev.ts).toLocaleTimeString()}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const [days, setDays] = useState<7 | 14 | 30 | 90>(30)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const {
    metrics,
    combined,
    funnel,
    funnelData,
    isFunnelDemo,
    dataMode,
    trendData,
    sourcesList,
    campaignsList,
    quality,
  } = useDashboardData(
    days,
    customFrom,
    customTo,
    campaignId,
    sourceFilter,
    0, // Will be updated by state in a real scenario if needed
    0, // Will be updated by state in a real scenario if needed
  )

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-lead-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        const r = payload.new as any
        setActivity((prev) => [{
          id: String(r.id ?? Math.random()),
          label: 'New lead received',
          detail: r.source ? `From ${r.source}` : 'New entry in pipeline',
          ts: r.created_at ?? new Date().toISOString(),
        }, ...prev].slice(0, 20))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        const r = payload.new as any
        setActivity((prev) => [{
          id: String(r.id ?? Math.random()) + '-upd',
          label: 'Lead updated',
          detail: r.stage ? `Stage: ${r.stage}` : 'Record updated',
          ts: r.updated_at ?? new Date().toISOString(),
        }, ...prev].slice(0, 20))
      })
      .subscribe()
    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [])

  if (metrics.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold">Dashboard</h1>
          <p className="text-muted mt-1">Loading metrics...</p>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-card rounded-lg" />
          <div className="h-24 bg-card rounded-lg" />
        </div>
      </div>
    )
  }

  const isCustomRange = Boolean(customFrom && customTo)
  const periodLabel = isCustomRange
    ? `${formatDateForLabel(customFrom)} → ${formatDateForLabel(customTo)}`
    : `últimos ${days} días`

  return (
    <div className="space-y-6">
      <DashboardHeader
        dataMode={dataMode}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        sourcesList={sourcesList}
        campaignId={campaignId}
        setCampaignId={setCampaignId}
        campaignsList={campaignsList}
        days={days}
        setDays={setDays}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        metaAccountIds={resolveMetaAccountIds(quality?.metaAccountIds ?? [])}
      />

      <AlertSection error={metrics.error} metaError={metrics.metaError} />

      <MetricsGrid metrics={metrics} quality={quality} />

      <FunnelAndSpendSection
        funnelData={funnelData}
        metrics={metrics}
        combined={combined}
        periodLabel={periodLabel}
        funnel={funnel}
        isFunnelDemo={isFunnelDemo}
        quality={quality}
      />

      <CampaignKpisSection metrics={metrics} trendData={trendData} periodLabel={periodLabel} />

      <ActivitySection activity={activity} />
    </div>
  )
}

