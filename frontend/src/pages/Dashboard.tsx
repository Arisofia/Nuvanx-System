import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { TrendingUp, Users, Zap, AlertCircle, DollarSign, ArrowUpRight, Percent, Target } from 'lucide-react'
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
import { AgentStatusCard } from '../components/dashboard/AgentStatusCard'

interface CombinedMetrics {
  metaEstimatedLeads: number
  verifiedRevenue: number
  metaCpl: number
  revenuePerLead: number
}

interface RealFunnel {
  metaSpend: number
  metaLeads: number
  crmLeads: number
  doctoraliaRevenue: number
  doctoraliaPatients: number
  cac: number
}

const DEMO_DASHBOARD_METRICS: DashboardMetrics = {
  totalLeads: 86,
  conversionRate: 4.2,
  activeCampaigns: 8,
  spend: 37_200,
  averageCpc: 1.07,
  loading: false,
  error: null,
}

const DEMO_COMBINED_METRICS: CombinedMetrics = {
  metaEstimatedLeads: 92,
  verifiedRevenue: 19_400,
  metaCpl: 1.18,
  revenuePerLead: 212,
}

const DEMO_FUNNEL: RealFunnel = {
  metaSpend: 12_450,
  metaLeads: 320,
  crmLeads: 250,
  doctoraliaRevenue: 24_580,
  doctoraliaPatients: 190,
  cac: 65,
}

export default function Dashboard() {
  const [days, setDays] = useState<7 | 14 | 30 | 90>(30)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [sourceFilter, setSourceFilter] = useState<string>('ALL')
  const [sourcesList, setSourcesList] = useState<string[]>([])
  const [campaignsList, setCampaignsList] = useState<{ id: string, name: string }[]>([])
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
<<<<<<< Updated upstream
  const [trendData, setTrendData] = useState<MetaTrendPoint[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

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

  useEffect(() => {
    const fetchMetrics = async () => {
      if (!supabaseUrl || !supabaseKey) {
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: 'Supabase environment variables are not configured.',
        }))
        return
      }

      // Guard: bail out if there is no active user session. The route guard in
      // App.tsx will redirect to /login — no need to show an error here.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setMetrics((prev) => ({ ...prev, loading: false }))
        return
      }

      try {
        const isCustomRange = Boolean(customFrom && customTo)
        const baseParams = isCustomRange ? `?from=${customFrom}&to=${customTo}` : `?days=${days}`
        const campaignParam = campaignId !== 'ALL' ? `&campaign_id=${campaignId}` : ''
        const sourceParam = sourceFilter !== 'ALL' ? `&source=${sourceFilter}` : ''
        const queryParams = `${baseParams}${campaignParam}`
        const dashboardParams = `${queryParams}${sourceParam}`
        const [metricsResult, metaTrendsResult, campaignsResult, insightsResult, funnelResult] = await Promise.allSettled([
          invokeApi(`/dashboard/metrics${dashboardParams}`),
          invokeApi(`/dashboard/meta-trends${queryParams}`),
          invokeApi(`/meta/campaigns${isCustomRange ? `?from=${customFrom}&to=${customTo}` : `?days=${days}`}`),
          invokeApi(`/meta/insights${queryParams}`),
          invokeApi('/dashboard/lead-flow'),
=======
  const [range, setRange] = useState<'7d' | '30d'>('30d')
  const [trendData, setTrendData] = useState<MetaTrendPoint[]>(defaultTrend)
  const [combined, setCombined] = useState<CombinedMetrics>({
    metaEstimatedLeads: 0,
    verifiedRevenue: 0,
    metaCpl: 0,
    revenuePerLead: 0,
  })
  const [funnel, setFunnel] = useState<RealFunnel | null>(null)
  const [isDemo, setIsDemo] = useState(false)
  const [isFunnelDemo, setIsFunnelDemo] = useState(false)

  useEffect(() => {
    const fetchMetrics = async () => {
      setMetrics((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const days = range === '30d' ? 30 : 7
        const [metricsResponse, metaTrendsResponse, campaignsResponse, metaInsightsResponse, kpisResponse] = await Promise.all([
          invokeApi('/dashboard/metrics'),
          invokeApi(`/dashboard/meta-trends?days=${days}`),
          invokeApi('/meta/campaigns'),
          invokeApi(`/meta/insights?days=${days}`),
          invokeApi(`/kpis?days=${days}`),
>>>>>>> Stashed changes
        ])

        // Lead/DB metrics — fatal if this fails
        if (metricsResult.status === 'rejected') {
          throw metricsResult.reason
        }
        const metricsData = metricsResult.value?.metrics ?? {}
        if (metricsData.bySource && Object.keys(metricsData.bySource).length > 0 && sourcesList.length === 0) {
          setSourcesList(Object.keys(metricsData.bySource))
        }

        if (funnelResult.status === 'fulfilled') {
          setFunnelData(funnelResult.value.funnel || [])
        }

        // Meta API calls — non-fatal, show specific warning
        const campaignsResponse = campaignsResult.status === 'fulfilled' ? campaignsResult.value : null
        const metaTrendsResponse = metaTrendsResult.status === 'fulfilled' ? metaTrendsResult.value : null
        const insightsResponse = insightsResult.status === 'fulfilled' ? insightsResult.value : null

        const metaFailureMessage = (campaignsResult.status === 'rejected' || insightsResult.status === 'rejected')
          ? ((campaignsResult as any).reason?.message || (insightsResult as any).reason?.message || 'Meta API unavailable')
          : null

        const campaigns = Array.isArray(campaignsResponse?.campaigns) ? campaignsResponse.campaigns : []
<<<<<<< Updated upstream
        if (campaigns.length > 0 && campaignsList.length === 0) {
          setCampaignsList(campaigns.map((c: any) => ({ id: c.id, name: c.name })))
        }

        // Use account-level summary from /meta/insights for accurate totals;
        // fall back to summing per-campaign if insights endpoint failed.
        const insightsSummary = insightsResponse?.summary
        const spend = insightsSummary?.spend != null
          ? Number(insightsSummary.spend)
          : Number(campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.spend ?? 0), 0))
        const avgCpcRaw = insightsSummary?.cpc != null
          ? Number(insightsSummary.cpc)
          : Number(
              campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.cpc ?? 0), 0) /
                Math.max(campaigns.filter((c: any) => Number(c.insights?.cpc ?? 0) > 0).length, 1),
            )
        const metaConversions = insightsSummary?.conversions != null
          ? Number(insightsSummary.conversions)
          : campaigns.reduce((sum: number, c: any) => sum + Number(c.insights?.conversions ?? 0), 0)

        const spendDelta = insightsResponse?.changes?.spend ?? 0
=======
        const insights = metaInsightsResponse?.summary ?? metaInsightsResponse
        const kpis = kpisResponse ?? {}
        const metaSpend = Number(kpis?.meta?.spend ?? 0)
        const metaLeads = Number(kpis?.meta?.leads ?? 0)
        const totalLeads = Number(kpis?.crm?.totalLeads ?? 0)
        const doctoraliaPatients = Number(kpis?.doctoralia?.newVerifiedPatients ?? 0)
        const doctoraliaRevenue = Number(kpis?.doctoralia?.verifiedRevenue ?? 0)
        const cac = kpis?.doctoralia?.cacDoctoralia ?? 0

        const avgCpc = Number(
          campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.cpc ?? 0), 0) /
            Math.max(campaigns.filter((campaign: any) => Number(campaign.insights?.cpc ?? 0) > 0).length, 1),
        )
        const spend = Number(
          campaigns.reduce((sum: number, campaign: any) => sum + Number(campaign.insights?.spend ?? 0), 0),
        )
        const metaCpl = metaLeads > 0 ? Number.parseFloat((spend / metaLeads).toFixed(2)) : 0
        const revenuePerLead = totalLeads > 0 ? Number.parseFloat((doctoraliaRevenue / totalLeads).toFixed(2)) : 0
>>>>>>> Stashed changes

        const hasRealDashboardMetrics = kpisResponse?.success === true && totalLeads >= 0

        if (!hasRealDashboardMetrics) {
          setIsDemo(true)
          setIsFunnelDemo(true)
          setMetrics(DEMO_DASHBOARD_METRICS)
          setTrendData(defaultTrend)
          setCombined(DEMO_COMBINED_METRICS)
          setFunnel(DEMO_FUNNEL)
          return
        }

        setIsDemo(false)
        setIsFunnelDemo(doctoraliaPatients === 0)
        setTrendData(
          Array.isArray(metaTrendsResponse?.trends)
            ? metaTrendsResponse.trends.map((item: any) => ({
                week: item.date_start ?? item.date ?? '–',
                value: Number(item.spend ?? 0),
              }))
            : [],
        )

        setMetrics({
<<<<<<< Updated upstream
          totalLeads: Number(metricsData.totalLeads ?? 0),
          conversionRate: Number(metricsData.conversionRate ?? 0),
          patientMatches: Number(metricsData.patientMatches ?? 0),
          patientConversionRate: Number(metricsData.patientConversionRate ?? 0),
          verifiedRevenue: Number(metricsData.verifiedRevenue ?? 0),
          totalRevenue: Number(metricsData.totalRevenue ?? 0),
          settledCount: Number(metricsData.settledCount ?? 0),
          activeCampaigns: campaigns.filter((c: any) => c.status === 'ACTIVE').length,
=======
          totalLeads,
          conversionRate: Number(metrics.conversionRate ?? 0),
          activeCampaigns: campaigns.length,
>>>>>>> Stashed changes
          spend,
          averageCpc: Number.isFinite(avgCpcRaw) ? Number.parseFloat(avgCpcRaw.toFixed(2)) : 0,
          metaConversions,
          deltas: {
            leads: metricsData.deltas?.leads ?? 0,
            revenue: metricsData.deltas?.revenue ?? 0,
            conversions: metricsData.deltas?.conversions ?? 0,
            patientMatches: metricsData.deltas?.patientMatches ?? 0,
            spend: Number(spendDelta),
          },
          loading: false,
          error: null,
          metaError: metaFailureMessage,
        })

        setCombined({
          metaEstimatedLeads: metaLeads,
          verifiedRevenue: doctoraliaRevenue,
          metaCpl,
          revenuePerLead,
        })

        setFunnel({
          metaSpend,
          metaLeads,
          crmLeads: totalLeads,
          doctoraliaRevenue,
          doctoraliaPatients,
          cac,
        })
      } catch (err: any) {
<<<<<<< Updated upstream
        console.error('Dashboard fetch failed:', err)
        setMetrics((prev) => ({
          ...prev,
          loading: false,
          error: err?.message || 'Unable to load dashboard metrics',
          metaError: null,
        }))
=======
        console.error('Meta dashboard fetch failed:', err)
        setIsDemo(true)
        setIsFunnelDemo(true)
        setMetrics(DEMO_DASHBOARD_METRICS)
        setTrendData(defaultTrend)
        setCombined(DEMO_COMBINED_METRICS)
        setFunnel(DEMO_FUNNEL)
>>>>>>> Stashed changes
      }
    }

    fetchMetrics()
<<<<<<< Updated upstream
  }, [days, customFrom, customTo, campaignId, sourceFilter, campaignsList.length, sourcesList.length])
=======
  }, [range])
>>>>>>> Stashed changes

  if (metrics.loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
<<<<<<< Updated upstream
          <p className="text-slate-400 mt-1">Loading metrics...</p>
=======
          <p className="text-slate-600 mt-1">Cargando métricas...</p>
>>>>>>> Stashed changes
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-slate-800 rounded-lg" />
          <div className="h-24 bg-slate-800 rounded-lg" />
        </div>
      </div>
    )
  }

  const isCustomRange = Boolean(customFrom && customTo)
  const periodLabel = isCustomRange ? `${customFrom} → ${customTo}` : `últimos ${days} días`

  return (
    <div className="space-y-6">
<<<<<<< Updated upstream
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-slate-400 mt-1">Control centre — Meta KPIs, agent status, adaptive plan</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2">
          {sourcesList.length > 0 && (
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
            >
              <option value="ALL">All Sources</option>
              {sourcesList.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {campaignsList.length > 0 && (
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
            >
              <option value="ALL">All Campaigns</option>
              {campaignsList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
              {([7, 14, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => { setDays(d); setCustomFrom(''); setCustomTo('') }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    !customFrom && days === d ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400 print:hidden">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => { setCustomFrom(e.target.value); setCustomTo((prev) => prev || new Date().toISOString().slice(0, 10)) }}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500 w-32"
              />
              <span className="text-slate-500">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-slate-500 w-32"
              />
            </div>
          </div>
        </div>
      </div>

      {metrics.error && (
        <div className="p-4 bg-red-950/40 border border-red-800 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-300">Connection Error</p>
            <p className="text-sm text-red-300 mt-1">{metrics.error}</p>
          </div>
        </div>
      )}

      {metrics.metaError && !metrics.error && (
        <div className="p-4 bg-amber-950/40 border border-amber-800 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-300">Meta Ads not connected</p>
            <p className="text-sm text-amber-300 mt-1">
              {metrics.metaError.includes('#200') || metrics.metaError.includes('permission')
                ? 'Your Meta token is missing ads_management or ads_read permissions. Reconnect your Meta account in Integrations to fix this.'
                : metrics.metaError}
            </p>
            <a
              href="/integrations"
              className="inline-block mt-2 text-sm font-medium text-amber-400 underline hover:text-amber-200"
            >
              Go to Integrations →
            </a>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
=======
      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(220px,260px)] xl:grid-cols-[1.05fr_minmax(220px,260px)]">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-slate-600 mt-1">
            Centro de control — KPIs Meta, datos verificados y funnel real.
          </p>
        </div>
        <label className="space-y-1 text-sm text-slate-300">
          <span>Periodo</span>
          <select
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={range}
            onChange={(event) => setRange(event.target.value as '7d' | '30d')}
          >
            <option value="7d">Últimos 7 días</option>
            <option value="30d">Últimos 30 días</option>
          </select>
        </label>
      </div>

      {isDemo && (
        <div className="mb-4 p-3 rounded bg-yellow-50 text-xs text-yellow-800 border border-yellow-200">
          Modo demo: algunos datos se muestran con valores simulados porque la API no devolvió datos reales o faltan credenciales.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
>>>>>>> Stashed changes
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads registrados en CRM</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
<<<<<<< Updated upstream
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{metrics.metaConversions.toLocaleString()}</div>
              {metrics.deltas && <MetricDelta value={metrics.deltas.conversions} />}
            </div>
            <p className="text-xs text-slate-500 mt-1">Conversiones Meta · {periodLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{metrics.totalLeads.toLocaleString()}</div>
              {metrics.deltas && <MetricDelta value={metrics.deltas.leads} />}
            </div>
            <p className="text-xs text-slate-500 mt-1">Leads en BD · {periodLabel}</p>
=======
            <div className="text-2xl font-bold">{metrics.totalLeads.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Leads reales que ya están registrados en el CRM</p>
>>>>>>> Stashed changes
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasa de conversión Meta</CardTitle>
            <TrendingUp className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.conversionRate}%</div>
<<<<<<< Updated upstream
            <p className="text-xs text-slate-500 mt-1">Leads → treatment/closed</p>
            {(metrics.patientConversionRate ?? 0) > 0 && (
              <p className="text-xs text-emerald-400 mt-0.5">
                {metrics.patientConversionRate}% → paciente confirmado ({metrics.patientMatches})
              </p>
            )}
          </CardContent>
        </Card>

        <AgentStatusCard />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Lead Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelChart data={funnelData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Meta Spend ({periodLabel})</CardTitle>
=======
            <p className="text-xs text-slate-500 mt-1">Tasa de conversión basada en datos de pipeline real</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Campañas activas</CardTitle>
            <Zap className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.activeCampaigns}</div>
            <p className="text-xs text-slate-500 mt-1">Meta campaigns currently synced</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Inversión Meta</CardTitle>
            <DollarSign className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${metrics.spend.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1">Inversión Meta en la ventana seleccionada</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Meta + Doctoralia</CardTitle>
>>>>>>> Stashed changes
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border p-4 bg-slate-950">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-400">Inversión Meta</span>
                <DollarSign className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="mt-3 text-2xl font-semibold">${metrics.spend.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">Inversión Meta en la ventana seleccionada</p>
            </div>
            <div className="rounded-xl border border-border p-4 bg-slate-950">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-400">Leads generados (Meta)</span>
                <Users className="h-4 w-4 text-sky-400" />
              </div>
              <p className="mt-3 text-2xl font-semibold">{combined.metaEstimatedLeads.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">Estimación de leads generados por Meta</p>
            </div>
            <div className="rounded-xl border border-border p-4 bg-slate-950">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-400">Leads registrados en CRM</span>
                <Users className="h-4 w-4 text-sky-400" />
              </div>
              <p className="mt-3 text-2xl font-semibold">{metrics.totalLeads.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">Leads que ya se han registrado en el CRM</p>
            </div>
            <div className="rounded-xl border border-border p-4 bg-slate-950">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-400">Ingresos verificados (Doctoralia)</span>
                <DollarSign className="h-4 w-4 text-amber-400" />
              </div>
              <p className="mt-3 text-2xl font-semibold">${combined.verifiedRevenue.toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-1">Ingresos oficiales verificados por Doctoralia</p>
            </div>
          </CardContent>
        </Card>

        {funnel && (
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2">
                <CardTitle>Embudo real</CardTitle>
                {isFunnelDemo && (
                  <p className="text-xs text-yellow-700">
                    Modo demo: usando datos mock; conecta Meta y Doctoralia para ver datos reales.
                  </p>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Inversión Meta</p>
                <p className="text-lg font-bold">€{funnel.metaSpend.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-500">Leads generados (Meta)</p>
                <p className="text-lg font-bold">{funnel.metaLeads.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-500">Leads registrados en CRM</p>
                <p className="text-lg font-bold">{funnel.crmLeads.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-slate-500">Ingresos verificados (Doctoralia)</p>
                <p className="text-lg font-bold">€{funnel.doctoraliaRevenue.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {funnel.doctoraliaPatients > 0
                    ? `CAC Doctoralia: €${funnel.cac.toLocaleString()}`
                    : 'CAC Doctoralia: n/a (sin pacientes verificados en el periodo)'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.85fr] xl:grid-cols-[1.6fr_0.9fr] gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Meta Spend (últimos {range === '30d' ? '30 días' : '7 días'})</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }} />
                <Area type="monotone" dataKey="value" stroke="#38bdf8" fill="url(#trendGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>KPIs de campañas Meta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Inversión</span>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
<<<<<<< Updated upstream
                <div className="flex items-baseline gap-2 mt-3">
                  <p className="text-2xl font-semibold">${metrics.spend.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  {metrics.deltas && <MetricDelta value={metrics.deltas.spend} inverse />}
                </div>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Revenue (Settled)</span>
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex items-baseline gap-2 mt-3">
                  <p className="text-2xl font-semibold">${(metrics.verifiedRevenue ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  {metrics.deltas && <MetricDelta value={metrics.deltas.revenue} />}
                </div>
                <p className="text-xs text-slate-500 mt-1">{metrics.settledCount ?? 0} settled · Doctoralia</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Pipeline (Est.)</span>
                  <DollarSign className="h-4 w-4 text-violet-400" />
                </div>
                <div className="flex items-baseline gap-2 mt-3">
                  <p className="text-2xl font-semibold">${(metrics.totalRevenue ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <p className="text-xs text-slate-500 mt-1">{metrics.totalRevenue === 0 ? 'No pipeline revenue yet' : 'Sum of leads.revenue'}</p>
=======
                <p className="mt-3 text-2xl font-semibold">${metrics.spend.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">Gasto total en Meta</p>
>>>>>>> Stashed changes
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">CPC medio</span>
                  <ArrowUpRight className="h-4 w-4 text-sky-400" />
                </div>
                <p className="mt-3 text-2xl font-semibold">${metrics.averageCpc.toFixed(2)}</p>
                <p className="text-xs text-slate-500 mt-1">Coste medio por clic en Meta</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">Conversiones</span>
                  <Percent className="h-4 w-4 text-amber-400" />
                </div>
<<<<<<< Updated upstream
                <p className="mt-3 text-2xl font-semibold">{metrics.metaConversions.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-slate-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-400">CAC (Meta)</span>
                  <Target className="h-4 w-4 text-rose-400" />
                </div>
                {metrics.spend > 0 && metrics.metaConversions > 0 ? (
                  <p className="mt-3 text-2xl font-semibold text-rose-300">
                    ${(metrics.spend / metrics.metaConversions).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                ) : (
                  <p
                    className="mt-3 text-2xl font-semibold text-slate-500"
                    title={metrics.metaConversions === 0 ? 'No conversions recorded in this period' : 'No spend data'}
                  >—</p>
                )}
                <p className="text-xs text-slate-500 mt-1">spend ÷ conversions</p>
=======
                <p className="mt-3 text-2xl font-semibold">{metrics.totalLeads.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">Leads atribuibles a campañas</p>
>>>>>>> Stashed changes
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Actividad reciente</CardTitle>
        </CardHeader>
        <CardContent>
<<<<<<< Updated upstream
          {activity.length === 0 ? (
            <p className="text-slate-500 text-sm">Waiting for new lead events via Supabase Realtime…</p>
          ) : (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {activity.map((ev) => (
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-700">
                  <p className="text-sm font-medium">{ev.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{ev.detail} • {new Date(ev.ts).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          )}
=======
          <p className="text-slate-600 text-sm">Conectando con Supabase Realtime...</p>
>>>>>>> Stashed changes
        </CardContent>
      </Card>
    </div>
  </div>
  )
}
