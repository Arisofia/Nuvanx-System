import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Eye, MousePointerClick, DollarSign, Target, Megaphone, Activity } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import type { CampaignRow, MarketingState } from '../types'
import { ExportButton } from '../components/reports/ExportButton'

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtCurrency = (n: number, currency = 'EUR') =>
  n.toLocaleString('es-MX', { style: 'currency', currency, minimumFractionDigits: 2 })

function DeltaBadge({ value }: Readonly<{ value: number | undefined }>) {
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
}: Readonly<{ label: string; value: string; sub?: string; icon: React.ReactNode; color?: string; delta?: number }>) {
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
}

const MARKETING_TODAY = new Date().toISOString().slice(0, 10)
const todayStr = MARKETING_TODAY

const STATUS_LABELS = {
  ALL: 'Todas',
  ACTIVE: 'Activas',
  PAUSED: 'Pausadas',
  ARCHIVED: 'Archivadas',
} as const

interface CampaignTableProps {
  campaigns: CampaignRow[];
  filteredCampaigns: CampaignRow[];
  currency: string;
  summary: MarketingState['summary'];
}

function CampaignTable({ campaigns, filteredCampaigns, currency, summary }: Readonly<CampaignTableProps>) {
  return (
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
                {(() => {
                  if (c.dailyBudget != null) {
                    return <><span className="text-slate-500">día</span> {fmtCurrency(c.dailyBudget, currency)}</>
                  }
                  if (c.lifetimeBudget != null) {
                    return <><span className="text-slate-500">vit</span> {fmtCurrency(c.lifetimeBudget, currency)}</>
                  }
                  return '—'
                })()}
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
  )
}

export default function Marketing() {
  const [state, setState] = useState<MarketingState>({
    summary: null,
    changes: null,
    daily: [],
    campaigns: [],
    currency: 'EUR',
    accountId: '',
    period: null,
    loading: true,
    error: null,
  })
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
        const isCustomRange = Boolean(customFrom)
        const effectiveTo = isCustomRange ? (customTo || todayStr) : todayStr

        const insightsParams = new URLSearchParams()
        if (isCustomRange) {
          insightsParams.set('from', customFrom)
          insightsParams.set('to', effectiveTo)
        } else {
          insightsParams.set('days', String(days))
        }
        if (campaignId !== 'ALL') {
          insightsParams.set('campaign_id', campaignId)
        }

        const campaignsParams = new URLSearchParams()
        if (isCustomRange) {
          campaignsParams.set('from', customFrom)
          campaignsParams.set('to', effectiveTo)
        } else {
          campaignsParams.set('days', String(days))
        }

        const [insightsRes, campaignsRes] = await Promise.allSettled([
          invokeApi(`/meta/insights?${insightsParams.toString()}`),
          invokeApi(`/meta/campaigns?${campaignsParams.toString()}`),
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

        const error =
          insightsRes.status === 'rejected' && campaignsRes.status === 'rejected'
            ? 'No se pudo cargar la información de Meta Ads.'
            : null

        setState({
          summary: insightsData?.summary ?? null,
          changes: insightsData?.changes ?? null,
          daily: Array.isArray(insightsData?.daily) ? insightsData.daily : [],
          campaigns: rawCampaigns,
          currency: insightsData?.currency ?? campaignsData?.currency ?? 'EUR',
          accountId: insightsData?.accountId ?? campaignsData?.accountId ?? '',
          period: insightsData?.period ?? null,
          loading: false,
          error,
        })
      } catch (err: any) {
        setState((prev) => ({ ...prev, loading: false, error: err?.message ?? 'Error cargando datos.' }))
      }
    }
    load()
  }, [days, campaignId, customFrom, customTo])

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
      Gasto: c.insights.spend,
      Clics: c.insights.clicks,
      Impresiones: Math.round(c.insights.impressions / 100),
      CTR: Number(c.insights.ctr.toFixed(2)),
      CPC: Number(c.insights.cpc.toFixed(3)),
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
      </div>

      {/* ── Daily spend + clicks chart ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Gasto diario · {days} días · ({currency})</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {loading && (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Cargando…</div>
          )}
          {!loading && dailyChart.length === 0 && (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">Sin datos diarios</div>
          )}
          {!loading && dailyChart.length > 0 && (
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
                cac: (c.insights && c.insights.conversions > 0)
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
                  {STATUS_LABELS[s]}
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
          {loading && (
            <p className="p-4 text-sm text-slate-500">Cargando campañas…</p>
          )}
          {!loading && filteredCampaigns.length === 0 && (
            <p className="p-4 text-sm text-slate-500">
              {campaigns.length === 0 ? 'No hay campañas disponibles.' : 'Ninguna campaña coincide con los filtros.'}
            </p>
          )}
          {!loading && filteredCampaigns.length > 0 && (
            <CampaignTable
              campaigns={campaigns}
              filteredCampaigns={filteredCampaigns}
              currency={currency}
              summary={summary}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
