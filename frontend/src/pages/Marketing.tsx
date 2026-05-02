import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Eye, MousePointerClick, DollarSign, Target, Megaphone, Activity } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'

interface CampaignRow {
  id: string
  name: string
  status: string
  objective: string
  dailyBudget: number | null
  lifetimeBudget: number | null
  source: string
  insights: {
    impressions: number
    reach: number
    clicks: number
    spend: number
    ctr: number
    cpc: number
    cpm: number
    conversions: number
    cpp: number | null
  } | null
}

interface AccountSummary {
  impressions: number
  reach: number
  clicks: number
  spend: number
  conversions: number
  messagingConversationStarted: number
  ctr: number
  cpc: number
  cpm: number
  cpp: number
}

interface DailyPoint {
  date: string
  impressions: number
  reach: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
  messagingConversationStarted: number
}

interface MarketingState {
  summary: AccountSummary | null
  daily: DailyPoint[]
  campaigns: CampaignRow[]
  period: { since: string; until: string; days: number } | null
  loading: boolean
  error: string | null
}

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtMXN = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })

function StatCard({
  label, value, sub, icon, color = 'text-white',
}: { label: string; value: string; sub?: string; icon: React.ReactNode; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-slate-800">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Marketing() {
  const [state, setState] = useState<MarketingState>({
    summary: null,
    daily: [],
    campaigns: [],
    period: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const [insightsRes, campaignsRes] = await Promise.allSettled([
          invokeApi('/meta/insights'),
          invokeApi('/meta/campaigns'),
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
          daily: Array.isArray(insightsData?.daily) ? insightsData.daily : [],
          campaigns: rawCampaigns,
          period: insightsData?.period ?? null,
          loading: false,
          error,
        })
      } catch (err: any) {
        setState((prev) => ({ ...prev, loading: false, error: err?.message ?? 'Error cargando datos.' }))
      }
    }
    load()
  }, [])

  const { summary, daily, campaigns, period, loading, error } = state

  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length

  // Daily chart — last 14 days
  const dailyChart = daily.slice(-14).map((d) => ({
    date: d.date.slice(5), // MM-DD
    Gasto: d.spend,
    Clics: d.clicks,
    Impresiones: Math.round(d.impressions / 100), // scale down for shared axis
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
      <div>
        <h1 className="text-3xl font-bold">Marketing · Meta Ads</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Período: {loading ? '…' : periodLabel} · Cuenta: act_4172099716404860
        </p>
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
          value={loading ? '…' : fmtMXN(summary?.spend ?? 0)}
          sub={periodLabel}
          icon={<DollarSign className="w-4 h-4 text-emerald-400" />}
          color="text-emerald-400"
        />
        <StatCard
          label="Impresiones"
          value={loading ? '…' : (summary?.impressions ?? 0).toLocaleString('es-MX')}
          sub={`Alcance: ${(summary?.reach ?? 0).toLocaleString('es-MX')}`}
          icon={<Eye className="w-4 h-4 text-sky-400" />}
          color="text-sky-400"
        />
        <StatCard
          label="Clics"
          value={loading ? '…' : (summary?.clicks ?? 0).toLocaleString('es-MX')}
          sub={`CTR: ${fmt(summary?.ctr ?? 0)}%`}
          icon={<MousePointerClick className="w-4 h-4 text-violet-400" />}
          color="text-violet-400"
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
        />
        <StatCard
          label="CPP (costo/resultado)"
          value={loading ? '…' : summary?.cpp ? `$${fmt(summary.cpp)}` : '—'}
          sub="Costo por resultado"
          icon={<TrendingDown className="w-4 h-4 text-orange-400" />}
        />
      </div>

      {/* ── Daily spend + clicks chart ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Gasto diario · últimos 14 días</CardTitle>
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
                    name === 'Gasto' ? [`$${Number(value).toFixed(2)}`, 'Gasto (MXN)'] : [value, name]
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
                    name === 'Gasto' ? [`$${Number(value).toFixed(2)}`, 'Gasto (MXN)'] : [value, name]
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
          <CardTitle>Detalle por campaña</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-slate-500">Cargando campañas…</p>
          ) : campaigns.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No hay campañas disponibles.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-3">Campaña</th>
                    <th className="text-center px-3 py-3">Estado</th>
                    <th className="text-center px-3 py-3">Objetivo</th>
                    <th className="text-right px-3 py-3">Presupuesto/día</th>
                    <th className="text-right px-3 py-3">Gasto</th>
                    <th className="text-right px-3 py-3">Impresiones</th>
                    <th className="text-right px-3 py-3">Alcance</th>
                    <th className="text-right px-3 py-3">Clics</th>
                    <th className="text-right px-3 py-3">CTR</th>
                    <th className="text-right px-3 py-3">CPC</th>
                    <th className="text-right px-3 py-3">CPM</th>
                    <th className="text-right px-3 py-3">Conversiones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {campaigns.map((c) => (
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
                      <td className="px-3 py-3 text-right text-slate-300">
                        {c.dailyBudget != null ? fmtMXN(c.dailyBudget) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-400">
                        {c.insights ? fmtMXN(c.insights.spend) : '—'}
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
                        {c.insights ? `$${fmt(c.insights.cpc, 3)}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-300">
                        {c.insights ? `$${fmt(c.insights.cpm)}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-lime-400">
                        {c.insights ? c.insights.conversions.toLocaleString('es-MX') : '—'}
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
                        {fmtMXN(summary?.spend ?? 0)}
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
                      <td className="px-3 py-3 text-right text-amber-400">${fmt(summary?.cpc ?? 0, 3)}</td>
                      <td className="px-3 py-3 text-right">${fmt(summary?.cpm ?? 0)}</td>
                      <td className="px-3 py-3 text-right text-lime-400">
                        {(summary?.conversions ?? 0).toLocaleString('es-MX')}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
