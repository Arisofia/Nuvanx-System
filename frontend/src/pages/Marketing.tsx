import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Eye, MousePointerClick, DollarSign, Target, Megaphone, Activity } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import type { CampaignRow, AccountSummary, DailyPoint, MetaChanges as Changes, MarketingState } from '../types'
import { ExportButton } from '../components/reports/ExportButton'

<<<<<<< Updated upstream
const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtCurrency = (n: number, currency = 'EUR') =>
  n.toLocaleString('es-MX', { style: 'currency', currency, minimumFractionDigits: 2 })

function DeltaBadge({ value }: { value: number | undefined }) {
  if (value == null || value === 0) return null
  const up = value > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ml-2 ${
      up ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
    }`}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function StatCard({
  label, value, sub, icon, color = 'text-white', delta,
}: { label: string; value: string; sub?: string; icon: React.ReactNode; color?: string; delta?: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
            <div className="flex items-center mt-1">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <DeltaBadge value={delta} />
            </div>
            {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-slate-800">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
=======
interface CampaignPerformance {
  id: string
  name: string
  source: string
  status: string
  objective: string
  spend: number
  conversions: number
  cpc: number
  cpp: number | null
  impressions: number
  clicks: number
  cpm: number | null
  roas: number | null
}

const fallbackData: CampaignPerformance[] = [
  { id: 'meta-search', name: 'Meta Search', source: 'Meta', status: 'ACTIVE', objective: 'traffic', spend: 14.6, conversions: 48, cpc: 1.24, cpp: 18.5, impressions: 18_500, clicks: 7_456, cpm: 0.80, roas: 3.4 },
  { id: 'meta-feed', name: 'Meta Feed', source: 'Meta', status: 'ACTIVE', objective: 'lead generation', spend: 12.3, conversions: 38, cpc: 1.08, cpp: 16.7, impressions: 15_200, clicks: 6_300, cpm: 0.81, roas: 3.1 },
  { id: 'google-search', name: 'Google Search', source: 'Google', status: 'ACTIVE', objective: 'search', spend: 9.8, conversions: 42, cpc: 0.95, cpp: 14.3, impressions: 13_600, clicks: 10_100, cpm: 0.72, roas: 2.9 },
  { id: 'google-display', name: 'Google Display', source: 'Google', status: 'ACTIVE', objective: 'display', spend: 6.1, conversions: 27, cpc: 0.72, cpp: 22.4, impressions: 11_900, clicks: 8_500, cpm: 0.51, roas: 2.4 },
]

// NOTE: estos son datos mock de fallback para Marketing.
// Cuando las llamadas a /meta/campaigns o /google-ads/campaigns fallen, se muestran valores de ejemplo.
interface MarketingMetrics {
  leadCount: number
  totalSpend: number
  avgCpc: number
  activeCampaigns: number
  campaigns: CampaignPerformance[]
  loading: boolean
  error: string | null
>>>>>>> Stashed changes
}

const MARKETING_TODAY = new Date().toISOString().slice(0, 10)
const todayStr = MARKETING_TODAY

export default function Marketing() {
<<<<<<< Updated upstream
  const [state, setState] = useState<MarketingState>({
    summary: null,
    changes: null,
    daily: [],
=======
  const [metrics, setMetrics] = useState<MarketingMetrics>({
    leadCount: 0,
    totalSpend: 0,
    avgCpc: 0,
    activeCampaigns: 0,
>>>>>>> Stashed changes
    campaigns: [],
    currency: 'EUR',
    accountId: '',
    period: null,
    loading: true,
    error: null,
  })
  const [isDemo, setIsDemo] = useState(false)
  const [range, setRange] = useState<'7d' | '30d'>('30d')
  const [platform, setPlatform] = useState<'all' | 'meta' | 'google'>('all')
  const [campaignId, setCampaignId] = useState<string>('')

  const [days, setDays] = useState(30)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'>('ALL')
  const [search, setSearch] = useState('')

  const since2025 = '2025-01-01'

  useEffect(() => {
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }))
      try {
<<<<<<< Updated upstream
        const isCustomRange = Boolean(customFrom)
        const effectiveTo = isCustomRange ? (customTo || todayStr) : todayStr
        const insightsQ = isCustomRange
          ? `?from=${customFrom}&to=${effectiveTo}${campaignId !== 'ALL' ? `&campaign_id=${campaignId}` : ''}`
          : `?days=${days}${campaignId !== 'ALL' ? `&campaign_id=${campaignId}` : ''}`
        const campaignsQ = isCustomRange ? `?from=${customFrom}&to=${effectiveTo}` : `?days=${days}`
        const [insightsRes, campaignsRes] = await Promise.allSettled([
          invokeApi(`/meta/insights${insightsQ}`),
          invokeApi(`/meta/campaigns${campaignsQ}`),
        ])

        const insightsData = insightsRes.status === 'fulfilled' ? insightsRes.value : null
        const campaignsData = campaignsRes.status === 'fulfilled' ? campaignsRes.value : null

        const rawCampaigns: CampaignRow[] = Array.isArray(campaignsData?.campaigns)
          ? campaignsData.campaigns.map((c: any) => ({
              id: c.id,
              name: c.name,
              status: c.status ?? 'UNKNOWN',
              objective: c.objective ?? '',
              dailyBudget: c.dailyBudget ?? null,
              lifetimeBudget: c.lifetimeBudget ?? null,
              source: 'Meta',
              insights: c.insights ?? null,
            }))
          : []
=======
        const params = `range=${range}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ''}`
        const metaUrl = `/meta/campaigns?${params}&source=meta`
        const googleUrl = `/google-ads/campaigns?${params}&source=google`

        const promises: Promise<any>[] = []
        if (platform === 'all' || platform === 'meta') promises.push(invokeApi(metaUrl))
        if (platform === 'all' || platform === 'google') promises.push(invokeApi(googleUrl))

        const settled = await Promise.allSettled(promises)
        const metaResult = platform === 'google' ? { status: 'rejected' as const } : settled[0]
        const googleResult = platform === 'meta' ? { status: 'rejected' as const } : settled[platform === 'all' ? 1 : 0]

        const metaCampaigns: CampaignPerformance[] =
          metaResult.status === 'fulfilled' && Array.isArray(metaResult.value?.campaigns)
            ? metaResult.value.campaigns.map((campaign: any) => ({
                id: String(campaign.id ?? campaign.campaign_id ?? campaign.name ?? 'meta-unknown'),
                name: campaign.name || 'Meta campaign',
                cpc: Number(campaign.insights?.cpc ?? 0),
                cpp: campaign.insights?.cpp ?? null,
                spend: Number(campaign.insights?.spend ?? 0),
                conversions: Number(campaign.insights?.conversions ?? 0),
                impressions: Number(campaign.insights?.impressions ?? 0),
                clicks: Number(campaign.insights?.clicks ?? 0),
                cpm: campaign.insights?.cpm ?? null,
                roas: campaign.insights?.roas ?? null,
                status: campaign.status ?? 'UNKNOWN',
                objective: campaign.objective ?? '',
                source: 'Meta',
              }))
            : []

        const googleCampaigns: CampaignPerformance[] =
          googleResult.status === 'fulfilled' && Array.isArray(googleResult.value?.campaigns)
            ? googleResult.value.campaigns.map((campaign: any) => ({
                id: String(campaign.id ?? campaign.campaign_id ?? campaign.name ?? 'google-unknown'),
                name: campaign.name || 'Google Ads campaign',
                cpc: Number(campaign.insights?.cpc ?? 0),
                cpp: campaign.insights?.cpp ?? null,
                spend: Number(campaign.insights?.spend ?? 0),
                conversions: Number(campaign.insights?.conversions ?? 0),
                impressions: Number(campaign.insights?.impressions ?? 0),
                clicks: Number(campaign.insights?.clicks ?? 0),
                cpm: campaign.insights?.cpm ?? null,
                roas: campaign.insights?.roas ?? null,
                status: campaign.status ?? 'UNKNOWN',
                objective: campaign.type ?? campaign.objective ?? '',
                source: 'Google',
              }))
            : []
>>>>>>> Stashed changes

        const error =
          insightsRes.status === 'rejected' && campaignsRes.status === 'rejected'
            ? 'No se pudo cargar la información de Meta Ads.'
            : null

<<<<<<< Updated upstream
        setState({
          summary: insightsData?.summary ?? null,
          changes: insightsData?.changes ?? null,
          daily: Array.isArray(insightsData?.daily) ? insightsData.daily : [],
          campaigns: rawCampaigns,
          currency: insightsData?.currency ?? campaignsData?.currency ?? 'EUR',
          accountId: insightsData?.accountId ?? campaignsData?.accountId ?? '',
          period: insightsData?.period ?? null,
=======
        setIsDemo(metaResult.status === 'rejected' && googleResult.status === 'rejected')
        setMetrics({
          leadCount: leadCount || 86,
          totalSpend: totalSpend || 38_700,
          activeCampaigns: campaigns.length,
          avgCpc: avgCpc || 1.07,
          campaigns: campaigns.length ? campaigns.slice(0, 6) : fallbackData,
>>>>>>> Stashed changes
          loading: false,
          error,
        })
      } catch (err: any) {
<<<<<<< Updated upstream
        setState((prev) => ({ ...prev, loading: false, error: err?.message ?? 'Error cargando datos.' }))
=======
        console.warn('Marketing data fetch failed, using fallback:', err)
        setIsDemo(true)
        setMetrics({
          leadCount: 86,
          totalSpend: 38_700,
          avgCpc: 1.07,
          campaigns: fallbackData,
          loading: false,
          error: 'Unable to load campaign metrics from Edge Functions; showing fallback data.',
        })
>>>>>>> Stashed changes
      }
    }
    load()
  }, [days, campaignId, customFrom, customTo])

<<<<<<< Updated upstream
  const { summary, changes, daily, campaigns, currency, accountId, period, loading, error } = state

  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length

  // Filtered campaigns for table
  const filteredCampaigns = campaigns.filter((c) => {
    if (campaignId !== 'ALL' && c.id !== campaignId) return false
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Daily spend + clicks chart
  const dailyChart = daily.map((d) => ({
    date: d.date.slice(5), // MM-DD
    Gasto: d.spend,
    Clics: d.clicks,
  }))

  // Daily CTR / CPC / CPM chart
  const dailyRatesChart = daily.map((d) => ({
    date: d.date.slice(5),
    'CTR (%)': Number(d.ctr.toFixed(2)),
    'CPC ($)': Number(d.cpc.toFixed(2)),
    'CPM ($)': Number(d.cpm.toFixed(2)),
    Conversaciones: d.messagingConversationStarted,
  }))

  // Per-campaign bar chart
  const campaignChart = campaigns
    .filter((c) => c.insights)
    .map((c) => ({
      name: c.name.length > 22 ? c.name.slice(0, 22) + '…' : c.name,
      Gasto: c.insights!.spend,
      Clics: c.insights!.clicks,
      Impresiones: Math.round(c.insights!.impressions / 100),
      CTR: Number(c.insights!.ctr.toFixed(2)),
      CPC: Number(c.insights!.cpc.toFixed(3)),
    }))

  const periodLabel = period
    ? `${period.since} → ${period.until} (${period.days} días)`
    : 'últimos 30 días'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Marketing · Meta Ads</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Período: {loading ? '…' : periodLabel}{accountId ? ` · Cuenta: ${accountId}` : ''} · Moneda: {loading ? '…' : currency}
          </p>
        </div>
        {/* Filters */}
        <div className="flex items-center gap-2">
          {campaigns.length > 0 && (
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
            >
              <option value="ALL">Todas las campañas</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            {([7, 14, 30, 90, 365] as const).map((d) => (
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
            <button
              onClick={() => { setCustomFrom(since2025); setCustomTo('') }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                customFrom === since2025 && !customTo ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Desde 2025
            </button>
          </div>
          {/* Custom date range inputs */}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-slate-800 text-white text-xs px-2 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
              placeholder="Desde"
            />
            <span className="text-slate-500 text-xs">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-slate-800 text-white text-xs px-2 py-1.5 rounded-lg border-none focus:ring-1 focus:ring-slate-500"
              placeholder="Hasta"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-300 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
          {error}
        </div>
      )}

      {/* ── KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Gasto total"
          value={loading ? '…' : fmtCurrency(summary?.spend ?? 0, currency)}
          sub={periodLabel}
          icon={<DollarSign className="w-4 h-4 text-emerald-400" />}
          color="text-emerald-400"
          delta={changes?.spend}
        />
        <StatCard
          label="Impresiones"
          value={loading ? '…' : (summary?.impressions ?? 0).toLocaleString('es-MX')}
          sub={`Alcance: ${(summary?.reach ?? 0).toLocaleString('es-MX')}`}
          icon={<Eye className="w-4 h-4 text-sky-400" />}
          color="text-sky-400"
          delta={changes?.impressions}
        />
        <StatCard
          label="Clics"
          value={loading ? '…' : (summary?.clicks ?? 0).toLocaleString('es-MX')}
          sub={`CTR: ${fmt(summary?.ctr ?? 0)}%`}
          icon={<MousePointerClick className="w-4 h-4 text-violet-400" />}
          color="text-violet-400"
          delta={changes?.clicks}
        />
        <StatCard
          label="CPC promedio"
          value={loading ? '…' : `$${fmt(summary?.cpc ?? 0)}`}
          sub={`CPM: $${fmt(summary?.cpm ?? 0)}`}
          icon={<Target className="w-4 h-4 text-amber-400" />}
          color="text-amber-400"
        />
        <StatCard
          label="Campañas activas"
          value={loading ? '…' : String(activeCampaigns)}
          sub={`${campaigns.length} en total`}
          icon={<Megaphone className="w-4 h-4 text-rose-400" />}
        />
        <StatCard
          label="Conversaciones iniciadas"
          value={loading ? '…' : String(summary?.messagingConversationStarted ?? 0)}
          sub="WhatsApp / Messenger"
          icon={<Activity className="w-4 h-4 text-teal-400" />}
        />
        <StatCard
          label="Conversiones"
          value={loading ? '…' : String(summary?.conversions ?? 0)}
          sub="Eventos de conversión Meta"
          icon={<TrendingUp className="w-4 h-4 text-lime-400" />}
          delta={changes?.conversions}
        />
        <StatCard
          label="Alcance"
          value={loading ? '…' : (summary?.reach ?? 0).toLocaleString('es-MX')}
          sub={`CPP: ${summary?.cpp ? '$' + fmt(summary.cpp) : '—'}`}
          icon={<TrendingDown className="w-4 h-4 text-orange-400" />}
          delta={changes?.reach}
        />
=======
    loadMarketingData()
  }, [range, platform, campaignId])

  // chartData usa datos reales cuando están disponibles y mocks de fallback cuando no.
  const chartData = (metrics.campaigns.length ? metrics.campaigns : fallbackData).map((campaign) => ({
    name: campaign.name,
    cpc: campaign.cpc,
    cpp: campaign.cpp ?? 0,
  }))

  const campaignRows = metrics.campaigns.length ? metrics.campaigns : fallbackData

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null
    return (
      <div className="rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100">
        <p className="font-semibold">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} className="mt-1">
            {entry.name}: ${entry.value}
            {entry.dataKey === 'cpc' && <span className="text-slate-400"> — coste por clic.</span>}
            {entry.dataKey === 'cpp' && <span className="text-slate-400"> — coste por paciente.</span>}
          </p>
        ))}
        <p className="mt-2 text-slate-400">ROAS (Meta+Google): ingreso atribuible / inversión.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Marketing</h1>
        <p className="text-slate-600 mt-1">Inteligencia de campañas Meta y Google — CPC, CPP y ROAS por campaña</p>
      </div>

      {isDemo && (
        <div className="mb-4 p-3 rounded bg-yellow-50 text-xs text-yellow-800 border border-yellow-200">
          Modo demo: algunos datos se muestran con valores simulados porque la integración de Meta/Google no está activa o no se pudo acceder al endpoint.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <div className="grid gap-3 sm:grid-cols-3">
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
          <label className="space-y-1 text-sm text-slate-300">
            <span>Plataforma</span>
            <select
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as 'all' | 'meta' | 'google')}
            >
              <option value="all">Meta + Google</option>
              <option value="meta">Solo Meta</option>
              <option value="google">Solo Google</option>
            </select>
          </label>
          <label className="space-y-1 text-sm text-slate-300">
            <span>Campaña</span>
            <select
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
            >
              <option value="">Todas</option>
              {campaignRows.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                {platform === 'meta'
                  ? `Inversión Meta (${range === '30d' ? '30 días' : '7 días'})`
                  : platform === 'google'
                  ? `Inversión Google (${range === '30d' ? '30 días' : '7 días'})`
                  : `Inversión Meta + Google (${range === '30d' ? '30 días' : '7 días'})`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${metrics.totalSpend.toLocaleString()}</div>
              <p className="text-xs text-slate-500 mt-1">
                Total gastado en campañas en la ventana seleccionada.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">ROAS</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">4.5x</div>
              <p className="text-xs text-slate-500 mt-1">Ingreso atribuible / inversión para la ventana seleccionada.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">CPC medio (Meta)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${metrics.avgCpc.toFixed(2)}</div>
              <p className="text-xs text-slate-500 mt-1">Coste medio por clic en Meta.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Campañas activas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.activeCampaigns}</div>
              <p className="text-xs text-slate-500 mt-1">Campañas con datos activos en Meta y Google.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Campañas</CardTitle>
            </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
              <table className="min-w-full text-left text-sm text-slate-200">
                <thead className="border-b border-slate-800 bg-slate-900 text-xs uppercase tracking-[0.16em] text-slate-400">
                  <tr>
                    <th className="px-3 py-3">Campaña</th>
                    <th className="px-3 py-3">Plataforma</th>
                    <th className="px-3 py-3">Impresiones</th>
                    <th className="px-3 py-3">Clicks</th>
                    <th className="px-3 py-3">CPM</th>
                    <th className="px-3 py-3">CPC</th>
                    <th className="px-3 py-3">CPP</th>
                    <th className="px-3 py-3">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map((campaign) => (
                    <tr key={campaign.id} className="border-b border-slate-800 last:border-none">
                      <td className="px-3 py-3 font-medium text-slate-100">{campaign.name}</td>
                      <td className="px-3 py-3 text-slate-400">{campaign.source}</td>
                      <td className="px-3 py-3 text-slate-400">{campaign.impressions.toLocaleString()}</td>
                      <td className="px-3 py-3 text-slate-400">{campaign.clicks.toLocaleString()}</td>
                      <td className="px-3 py-3 text-slate-400">{campaign.cpm != null ? `$${campaign.cpm.toFixed(2)}` : '–'}</td>
                      <td className="px-3 py-3 text-slate-400">${campaign.cpc.toFixed(2)}</td>
                      <td className="px-3 py-3 text-slate-400">{campaign.cpp != null ? `$${campaign.cpp.toFixed(2)}` : '–'}</td>
                      <td className="px-3 py-3 text-slate-400">{campaign.roas != null ? `${campaign.roas.toFixed(1)}x` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
>>>>>>> Stashed changes
      </div>

      {/* ── Daily spend + clicks chart ────────────────────────────── */}
      <Card>
        <CardHeader>
<<<<<<< Updated upstream
          <CardTitle>Gasto diario · {days} días · ({currency})</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Cargando…</div>
          ) : dailyChart.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Sin datos diarios</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818cf8" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                  formatter={(value: any, name: string) =>
                    name === 'Gasto' ? [`${fmtCurrency(Number(value), currency)}`, `Gasto (${currency})`] : [value, name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Gasto" stroke="#34d399" fill="url(#spendGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="Clics" stroke="#818cf8" fill="url(#clicksGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Daily CTR / CPC / CPM chart ──────────────────────────── */}
      {dailyRatesChart.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>CTR · CPC · CPM diario · {days} días</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyRatesChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="ctrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cpcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f472b6" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#f472b6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cpmGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                  formatter={(value: any, name: string) => [
                    name.includes('%') ? `${Number(value).toFixed(2)}%` : `${fmtCurrency(Number(value), currency)}`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="CTR (%)" stroke="#f59e0b" fill="url(#ctrGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="CPC ($)" stroke="#f472b6" fill="url(#cpcGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="CPM ($)" stroke="#22d3ee" fill="url(#cpmGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Per-campaign bar chart ────────────────────────────────── */}
      {campaignChart.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Gasto vs Clics por campaña</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={campaignChart} margin={{ top: 8, right: 16, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-20}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                  formatter={(value: any, name: string) =>
                    name === 'Gasto' ? [`${fmtCurrency(Number(value), currency)}`, `Gasto (${currency})`] : [value, name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Gasto" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Clics" fill="#818cf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Campaign detail table ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="flex-1">Detalle por campaña</CardTitle>
            {/* Export */}
            <ExportButton
              data={filteredCampaigns.map((c) => ({
                name: c.name,
                status: c.status,
                objective: c.objective,
                spend: c.insights?.spend ?? '',
                impressions: c.insights?.impressions ?? '',
                reach: c.insights?.reach ?? '',
                clicks: c.insights?.clicks ?? '',
                ctr: c.insights?.ctr ?? '',
                cpc: c.insights?.cpc ?? '',
                cpm: c.insights?.cpm ?? '',
                conversions: c.insights?.conversions ?? '',
                cpp: c.insights?.cpp ?? '',
                cac: c.insights && c.insights.conversions > 0
                  ? (c.insights.spend / c.insights.conversions).toFixed(2)
                  : '',
              }))}
              filename="meta-campaigns"
              disabled={loading}
            />
            {/* Status filter */}
            <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
              {(['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    statusFilter === s ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s === 'ALL' ? 'Todas' : s === 'ACTIVE' ? 'Activas' : s === 'PAUSED' ? 'Pausadas' : 'Archivadas'}
                </button>
              ))}
            </div>
            {/* Search */}
            <input
              type="text"
              placeholder="Buscar campaña…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder-slate-500 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-slate-500"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-slate-500">Cargando campañas…</p>
          ) : filteredCampaigns.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">
              {campaigns.length === 0 ? 'No hay campañas disponibles.' : 'Ninguna campaña coincide con los filtros.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Campaña</th>
                    <th className="text-center px-3 py-3">Estado</th>
                    <th className="text-center px-3 py-3">Objetivo</th>
                    <th className="text-right px-3 py-3">Presupuesto</th>
                    <th className="text-right px-3 py-3">Gasto</th>
                    <th className="text-right px-3 py-3">Impresiones</th>
                    <th className="text-right px-3 py-3">Alcance</th>
                    <th className="text-right px-3 py-3">Clics</th>
                    <th className="text-right px-3 py-3">CTR</th>
                    <th className="text-right px-3 py-3">CPC</th>
                    <th className="text-right px-3 py-3">CPM</th>
                    <th className="text-right px-3 py-3">Conversiones</th>
                    <th className="text-right px-3 py-3">CPP</th>
                    <th className="text-right px-3 py-3" title="Customer Acquisition Cost = Gasto ÷ Conversiones">CAC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredCampaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-medium max-w-[200px]">
                        <span title={c.name} className="truncate block">{c.name}</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.status === 'ACTIVE'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          {c.status === 'ACTIVE' ? '● ' : '○ '}{c.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-slate-400 text-xs">{c.objective || '—'}</td>
                      <td className="px-3 py-3 text-right text-slate-300 text-xs">
                        {c.dailyBudget != null
                          ? <><span className="text-slate-500">día</span> {fmtCurrency(c.dailyBudget, currency)}</>
                          : c.lifetimeBudget != null
                            ? <><span className="text-slate-500">vit</span> {fmtCurrency(c.lifetimeBudget, currency)}</>
                            : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-400">
                        {c.insights ? fmtCurrency(c.insights.spend, currency) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {c.insights ? c.insights.impressions.toLocaleString('es-MX') : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {c.insights ? c.insights.reach.toLocaleString('es-MX') : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-violet-400">
                        {c.insights ? c.insights.clicks.toLocaleString('es-MX') : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {c.insights ? `${fmt(c.insights.ctr)}%` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-amber-400">
                        {c.insights ? fmtCurrency(c.insights.cpc, currency) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {c.insights ? fmtCurrency(c.insights.cpm, currency) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-lime-400">
                        {c.insights ? c.insights.conversions.toLocaleString('es-MX') : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-orange-400">
                        {c.insights?.cpp != null ? fmtCurrency(c.insights.cpp, currency) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {c.insights && c.insights.conversions > 0
                          ? <span className="text-rose-300 font-medium">{fmtCurrency(c.insights.spend / c.insights.conversions, currency)}</span>
                          : <span className="text-slate-500" title="No conversions in this period">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                {campaigns.some((c) => c.insights) && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300">
                      <td className="px-4 py-3 text-slate-400 uppercase tracking-wide">Total cuenta</td>
                      <td colSpan={3} />
                      <td className="px-3 py-3 text-right text-emerald-400">
                        {fmtCurrency(summary?.spend ?? 0, currency)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {(summary?.impressions ?? 0).toLocaleString('es-MX')}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {(summary?.reach ?? 0).toLocaleString('es-MX')}
                      </td>
                      <td className="px-3 py-3 text-right text-violet-400">
                        {(summary?.clicks ?? 0).toLocaleString('es-MX')}
                      </td>
                      <td className="px-3 py-3 text-right">{fmt(summary?.ctr ?? 0)}%</td>
                      <td className="px-3 py-3 text-right text-amber-400">{fmtCurrency(summary?.cpc ?? 0, currency)}</td>
                      <td className="px-3 py-3 text-right">{fmtCurrency(summary?.cpm ?? 0, currency)}</td>
                      <td className="px-3 py-3 text-right text-lime-400">
                        {(summary?.conversions ?? 0).toLocaleString('es-MX')}
                      </td>
                      <td className="px-3 py-3 text-right text-orange-400">
                        {summary?.cpp ? fmtCurrency(summary.cpp, currency) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-rose-300">
                        {summary && summary.conversions > 0
                          ? fmtCurrency(summary.spend / summary.conversions, currency)
                          : <span className="text-slate-500" title="No conversions in this period">—</span>}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
=======
          <CardTitle>Rendimiento de campañas</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="cpc" fill="#3b82f6" name="CPC ($)" />
              <Bar dataKey="cpp" fill="#f59e0b" name="CPP ($)" />
            </BarChart>
          </ResponsiveContainer>
>>>>>>> Stashed changes
        </CardContent>
      </Card>
    </div>
    </div>
  )
}
