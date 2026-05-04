import { useEffect, useState, useMemo, type ReactNode } from 'react'
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
      up ? 'bg-[#28A745]/10 text-[#28A745]' : 'bg-[#D9534F]/10 text-[#D9534F]'
    }`}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function StatCard({
  label, value, sub, icon, color = 'text-foreground', delta,
}: Readonly<{ label: string; value: string; sub?: string; icon: ReactNode; color?: string; delta?: number }>) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted font-medium uppercase tracking-wide">{label}</p>
            <div className="flex items-center mt-1">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <DeltaBadge value={delta} />
            </div>
            {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-card">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

const MARKETING_TODAY = new Date().toISOString().slice(0, 10)

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
          <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
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
        <tbody className="divide-y divide-border">
          {filteredCampaigns.map((c) => (
            <tr key={c.id} className="hover:bg-card/40 transition-colors">
              <td className="px-4 py-3 font-medium max-w-[200px]">
                <span title={c.name} className="truncate block">{c.name}</span>
              </td>
              <td className="px-3 py-3 text-center">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  c.status === 'ACTIVE'
                    ? 'bg-[#28A745]/10 text-[#28A745] border border-[#28A745]/30'
                    : 'bg-card text-muted border border-border'
                }`}>
                  {c.status === 'ACTIVE' ? '● ' : '○ '}{c.status}
                </span>
              </td>
              <td className="px-3 py-3 text-center text-muted text-xs">{c.objective || '—'}</td>
              <td className="px-3 py-3 text-right text-muted text-xs">
                {(() => {
                  if (c.dailyBudget != null) {
                    return <><span className="text-muted">día</span> {fmtCurrency(c.dailyBudget, currency)}</>
                  }
                  if (c.lifetimeBudget != null) {
                    return <><span className="text-muted">vit</span> {fmtCurrency(c.lifetimeBudget, currency)}</>
                  }
                  return '—'
                })()}
              </td>
              <td className="px-3 py-3 text-right font-semibold text-[#28A745]">
                {c.insights ? fmtCurrency(c.insights.spend, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? c.insights.impressions.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? c.insights.reach.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? c.insights.clicks.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? `${fmt(c.insights.ctr)}%` : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#C49A6C]">
                {c.insights ? fmtCurrency(c.insights.cpc, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? fmtCurrency(c.insights.cpm, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#28A745]">
                {c.insights ? c.insights.conversions.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#B08B5A]">
                {c.insights?.cpp == null ? '—' : fmtCurrency(c.insights.cpp, currency)}
              </td>
              <td className="px-3 py-3 text-right">
                {c.insights && c.insights.conversions > 0
                  ? <span className="text-[#D9534F] font-medium">{fmtCurrency(c.insights.spend / c.insights.conversions, currency)}</span>
                  : <span className="text-muted" title="No conversions in this period">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
        {/* Totals row */}
        {campaigns.some((c) => c.insights) && (
          <tfoot>
            <tr className="border-t-2 border-border bg-surface text-xs font-semibold text-foreground">
              <td className="px-4 py-3 text-muted uppercase tracking-wide">Total cuenta</td>
              <td colSpan={3} />
              <td className="px-3 py-3 text-right text-[#28A745]">
                {fmtCurrency(summary?.spend ?? 0, currency)}
              </td>
              <td className="px-3 py-3 text-right">
                {(summary?.impressions ?? 0).toLocaleString('es-MX')}
              </td>
              <td className="px-3 py-3 text-right">
                {(summary?.reach ?? 0).toLocaleString('es-MX')}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {(summary?.clicks ?? 0).toLocaleString('es-MX')}
              </td>
              <td className="px-3 py-3 text-right">{fmt(summary?.ctr ?? 0)}%</td>
              <td className="px-3 py-3 text-right text-[#C49A6C]">{fmtCurrency(summary?.cpc ?? 0, currency)}</td>
              <td className="px-3 py-3 text-right">{fmtCurrency(summary?.cpm ?? 0, currency)}</td>
              <td className="px-3 py-3 text-right text-[#28A745]">
                {(summary?.conversions ?? 0).toLocaleString('es-MX')}
              </td>
              <td className="px-3 py-3 text-right text-[#B08B5A]">
                {summary?.cpp ? fmtCurrency(summary.cpp, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#D9534F]">
                {summary && summary.conversions > 0
                  ? fmtCurrency(summary.spend / summary.conversions, currency)
                  : <span className="text-muted" title="No conversions in this period">—</span>}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const mapCampaignRow = (c: any): CampaignRow => ({
  id: c.id,
  name: c.name,
  status: c.status ?? 'UNKNOWN',
  objective: c.objective ?? '',
  dailyBudget: c.dailyBudget ?? null,
  lifetimeBudget: c.lifetimeBudget ?? null,
  source: 'Meta',
  insights: c.insights ?? null,
})

const buildMarketingParams = (isCustomRange: boolean, customFrom: string, customTo: string, days: number, campaignId?: string) => {
  const p = new URLSearchParams()
  if (isCustomRange) {
    p.set('from', customFrom)
    p.set('to', customTo || MARKETING_TODAY)
  } else {
    p.set('days', String(days))
  }
  if (campaignId && campaignId !== 'ALL') {
    p.set('campaign_id', campaignId)
  }
  return p.toString()
}

const filterCampaign = (c: CampaignRow, campaignId: string, statusFilter: string, search: string) => {
  if (campaignId !== 'ALL' && c.id !== campaignId) return false
  if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
  if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
  return true
}

const mapDailyToChart = (d: any) => ({
  date: d.date.slice(5),
  Gasto: d.spend,
  Clics: d.clicks,
})

const mapDailyToRatesChart = (d: any) => ({
  date: d.date.slice(5),
  'CTR (%)': Number(d.ctr.toFixed(2)),
  'CPC ($)': Number(d.cpc.toFixed(2)),
  'CPM ($)': Number(d.cpm.toFixed(2)),
  Conversaciones: d.messagingConversationStarted,
})

const mapCampaignToChart = (c: CampaignRow) => ({
  name: c.name.length > 22 ? c.name.slice(0, 22) + '…' : c.name,
  Gasto: c.insights?.spend ?? 0,
  Clics: c.insights?.clicks ?? 0,
  Impresiones: Math.round((c.insights?.impressions ?? 0) / 100),
  CTR: Number((c.insights?.ctr ?? 0).toFixed(2)),
  CPC: Number((c.insights?.cpc ?? 0).toFixed(3)),
})

function AdsTable({ adsState, currency }: Readonly<{ adsState: any; currency: string }>) {
  if (adsState.loading) {
    return <p className="p-4 text-sm text-muted animate-pulse">Cargando anuncios…</p>
  }
  if (adsState.error) {
    return <p className="p-4 text-sm text-red-400">{adsState.error}</p>
  }
  if (adsState.ads.length === 0) {
    return <p className="p-4 text-sm text-muted">No hay anuncios disponibles para el período seleccionado.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
            <th className="text-left px-4 py-3">Anuncio</th>
            <th className="text-left px-3 py-3">Campaña</th>
            <th className="text-center px-3 py-3">Estado</th>
            <th className="text-right px-3 py-3">Gasto</th>
            <th className="text-right px-3 py-3">Impresiones</th>
            <th className="text-right px-3 py-3">Clics</th>
            <th className="text-right px-3 py-3">CTR</th>
            <th className="text-right px-3 py-3">CPC</th>
            <th className="text-right px-3 py-3">CPM</th>
            <th className="text-right px-3 py-3">Conversiones</th>
            <th className="text-right px-3 py-3">CPP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {adsState.ads.map((ad: any) => (
            <tr key={ad.id} className="hover:bg-card/40 transition-colors">
              <td className="px-4 py-3 font-medium max-w-[200px]">
                <span title={ad.name} className="truncate block">{ad.name}</span>
                {ad.adsetName && <span className="text-muted text-xs truncate block">{ad.adsetName}</span>}
              </td>
              <td className="px-3 py-3 text-muted text-xs max-w-[160px]">
                <span title={ad.campaignName ?? ''} className="truncate block">{ad.campaignName ?? '—'}</span>
              </td>
              <td className="px-3 py-3 text-center">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  ad.status === 'ACTIVE'
                    ? 'bg-[#28A745]/10 text-[#28A745] border border-[#28A745]/30'
                    : 'bg-card text-muted border border-border'
                }`}>
                  {ad.status === 'ACTIVE' ? '● ' : '○ '}{ad.status}
                </span>
              </td>
              <td className="px-3 py-3 text-right font-semibold text-[#28A745]">
                {ad.insights ? fmtCurrency(ad.insights.spend, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {ad.insights ? ad.insights.impressions.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {ad.insights ? ad.insights.clicks.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {ad.insights ? `${fmt(ad.insights.ctr)}%` : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#C49A6C]">
                {ad.insights ? fmtCurrency(ad.insights.cpc, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {ad.insights ? fmtCurrency(ad.insights.cpm, currency) : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#28A745]">
                {ad.insights ? ad.insights.conversions.toLocaleString('es-MX') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-[#B08B5A]">
                {ad.insights?.cpp == null ? '—' : fmtCurrency(ad.insights.cpp, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const useMarketingData = (days: number, campaignId: string, customFrom: string, customTo: string) => {
  const [state, setState] = useState<MarketingState>({
    summary: null,
    changes: null,
    daily: [],
    campaigns: [],
    currency: 'EUR',
    accountId: '',
    accountIds: [],
    period: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const load = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }))
      try {
        const isCustomRange = Boolean(customFrom)
        const iParams = buildMarketingParams(isCustomRange, customFrom, customTo, days, campaignId)
        const cParams = buildMarketingParams(isCustomRange, customFrom, customTo, days)

        const [insightsRes, campaignsRes] = await Promise.allSettled([
          invokeApi(`/meta/insights?${iParams}`),
          invokeApi(`/meta/campaigns?${cParams}`),
        ])

        const insightsData = insightsRes.status === 'fulfilled' ? insightsRes.value : null
        const campaignsData = campaignsRes.status === 'fulfilled' ? campaignsRes.value : null

        const rawCampaigns: CampaignRow[] = Array.isArray(campaignsData?.campaigns)
          ? campaignsData.campaigns.map(mapCampaignRow)
          : []

        const failedBoth = insightsRes.status === 'rejected' && campaignsRes.status === 'rejected'
        const error = failedBoth ? 'No se pudo cargar la información de Meta Ads.' : null

        const accountIds = Array.isArray(insightsData?.accountIds)
          ? insightsData?.accountIds
          : Array.isArray(campaignsData?.accountIds)
            ? campaignsData?.accountIds
            : []
        setState({
          summary: insightsData?.summary ?? null,
          changes: insightsData?.changes ?? null,
          daily: Array.isArray(insightsData?.daily) ? insightsData.daily : [],
          campaigns: rawCampaigns,
          currency: insightsData?.currency ?? campaignsData?.currency ?? 'EUR',
          accountId: insightsData?.accountId ?? campaignsData?.accountId ?? accountIds[0] ?? '',
          accountIds,
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

  return state
}

function MarketingHeader({
  loading, periodLabel, accountIds, currency, campaigns, campaignId, setCampaignId,
  days, setDays, customFrom, setCustomFrom, customTo, setCustomTo, since2025,
}: Readonly<{
  loading: boolean; periodLabel: string; accountIds: string[]; currency: string; campaigns: CampaignRow[];
  campaignId: string; setCampaignId: (id: string) => void; days: number; setDays: (d: number) => void;
  customFrom: string; setCustomFrom: (s: string) => void; customTo: string; setCustomTo: (s: string) => void;
  since2025: string;
}>) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-4">
      <div className="flex-1">
        <h1 className="text-3xl font-serif font-bold text-foreground">Marketing · Meta Ads</h1>
        <p className="text-muted mt-1 text-sm">
          Período: {loading ? '…' : periodLabel}
        {accountIds.length > 0 ? ` · Cuenta${accountIds.length > 1 ? 's' : ''}: ${accountIds.join(', ')}` : ''}
        · Moneda: {loading ? '…' : currency}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {campaigns.length > 0 && (
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="bg-card text-foreground text-xs font-medium px-3 py-1.5 rounded-lg border border-border focus:ring-1 focus:ring-primary"
          >
            <option value="ALL">Todas las campañas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1 bg-card rounded-lg p-1">
          {([7, 14, 30, 90, 365] as const).map((d) => (
            <button
              key={d}
              onClick={() => { setDays(d); setCustomFrom(''); setCustomTo('') }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                !customFrom && days === d ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
              }`}
            >
              {d}d
            </button>
          ))}
          <button
            onClick={() => { setCustomFrom(since2025); setCustomTo('') }}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              customFrom === since2025 && !customTo ? 'bg-primary text-white' : 'text-muted hover:text-foreground'
            }`}
          >
            Desde 2025
          </button>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="bg-card text-foreground text-xs px-2 py-1.5 rounded-lg border border-border focus:ring-1 focus:ring-primary"
          />
          <span className="text-muted text-xs">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="bg-card text-foreground text-xs px-2 py-1.5 rounded-lg border border-border focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}

export default function Marketing() {
  const [days, setDays] = useState(30)
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')
  const [campaignId, setCampaignId] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED'>('ALL')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'campaigns' | 'ads'>('campaigns')
  const [adsState, setAdsState] = useState<{ ads: any[]; loading: boolean; loaded: boolean; error: string | null }>({
    ads: [], loading: false, loaded: false, error: null,
  })

  const state = useMarketingData(days, campaignId, customFrom, customTo)

  const since2025 = '2025-01-01'

  // Fetch ads on demand when ads tab is first opened
  useEffect(() => {
    if (activeTab !== 'ads') return
    if (adsState.loaded) return
    setAdsState((prev) => ({ ...prev, loading: true, error: null }))
    const params = buildMarketingParams(Boolean(customFrom), customFrom, customTo, days)
    invokeApi(`/meta/ads?${params}`)
      .then((data: any) => {
        setAdsState({ ads: data?.ads ?? [], loading: false, loaded: true, error: null })
      })
      .catch((err: any) => {
        setAdsState({ ads: [], loading: false, loaded: true, error: err?.message ?? 'Error cargando anuncios.' })
      })
  }, [activeTab, adsState.loaded, days, customFrom, customTo])

  // If the selected campaign no longer exists in the current state window, fall back to ALL.
  useEffect(() => {
    if (campaignId !== 'ALL' && state.campaigns.length > 0 && !state.campaigns.some((c) => c.id === campaignId)) {
      setCampaignId('ALL')
    }
  }, [state.campaigns, campaignId])

  const { summary, changes, daily, campaigns, currency, accountIds, period, loading, error } = state

  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => filterCampaign(c, campaignId, statusFilter, search))
  }, [campaigns, campaignId, statusFilter, search])

  const dailyChart = useMemo(() => daily.map(mapDailyToChart), [daily])

  const dailyRatesChart = useMemo(() => daily.map(mapDailyToRatesChart), [daily])

  const campaignChart = useMemo(() => {
    return campaigns
      .filter((c) => c.insights)
      .map(mapCampaignToChart)
  }, [campaigns])

  const periodLabel = period
    ? `${period.since} → ${period.until} (${period.days} días)`
    : 'últimos 30 días'

  return (
    <div className="space-y-6">
      <MarketingHeader
        loading={loading}
        periodLabel={periodLabel}
        accountIds={accountIds}
        currency={currency}
        campaigns={campaigns}
        campaignId={campaignId}
        setCampaignId={setCampaignId}
        days={days}
        setDays={setDays}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
        since2025={since2025}
      />

      {error && (
        <div className="rounded-md border border-[#E0A020]/30 bg-[#E0A020]/8 px-4 py-3 text-sm text-[#E0A020]">
          {error}
        </div>
      )}

      {/* Empty state: no meta data for selected period */}
      {!loading && !error && !summary && campaigns.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center space-y-3">
          <p className="text-muted font-medium">No hay datos de Meta Ads para este período</p>
          <p className="text-muted text-xs max-w-md mx-auto">
            Ejecuta el script de sincronización para importar historial o verifica que el token de Meta Ads sea válido.
          </p>
          <div className="flex justify-center gap-3 mt-2">
            <code className="bg-surface text-xs text-muted px-3 py-1.5 rounded-lg border border-border">
              node scripts/meta-backfill.js
            </code>
          </div>
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
          value={loading ? '…' : fmtCurrency(summary?.cpc ?? 0, currency)}
          sub={`CPM: ${fmtCurrency(summary?.cpm ?? 0, currency)}`}
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
          sub={`CPP: ${summary?.cpp ? fmtCurrency(summary.cpp, currency) : '—'}`}
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
            <div className="h-full flex items-center justify-center text-muted text-sm">Cargando…</div>
          )}
          {!loading && dailyChart.length === 0 && (
            <div className="h-full flex items-center justify-center text-muted text-sm">Sin datos diarios</div>
          )}
          {!loading && dailyChart.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#C49A6C" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#C49A6C" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7A7573" stopOpacity={0.7} />
                    <stop offset="95%" stopColor="#7A7573" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E2DE" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#7A7573', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#7A7573', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E2DE', fontSize: 12 }}
                  formatter={(value: any, name: string) =>
                    name === 'Gasto' ? [`${fmtCurrency(Number(value), currency)}`, `Gasto (${currency})`] : [value, name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Gasto" stroke="#C49A6C" fill="url(#spendGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="Clics" stroke="#7A7573" fill="url(#clicksGrad)" strokeWidth={2} />
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
                    <stop offset="5%" stopColor="#C49A6C" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#C49A6C" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cpcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#B08B5A" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#B08B5A" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="cpmGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7A7573" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#7A7573" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E2DE" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#7A7573', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#7A7573', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E2DE', fontSize: 12 }}
                  formatter={(value: any, name: string) => [
                    name.includes('%') ? `${Number(value).toFixed(2)}%` : `${fmtCurrency(Number(value), currency)}`,
                    name,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="CTR (%)" stroke="#C49A6C" fill="url(#ctrGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="CPC ($)" stroke="#B08B5A" fill="url(#cpcGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="CPM ($)" stroke="#7A7573" fill="url(#cpmGrad)" strokeWidth={2} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E2DE" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#7A7573', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-20}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fill: '#7A7573', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E6E2DE', fontSize: 12 }}
                  formatter={(value: any, name: string) =>
                    name === 'Gasto' ? [`${fmtCurrency(Number(value), currency)}`, `Gasto (${currency})`] : [value, name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Gasto" fill="#C49A6C" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Clics" fill="#7A7573" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Tab switcher: Campañas / Anuncios ─────────────────────── */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {(['campaigns', 'ads'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            {tab === 'campaigns' ? 'Campañas' : 'Por anuncio'}
          </button>
        ))}
      </div>

      {/* ── Campaign detail table ─────────────────────────────────── */}
      {activeTab === 'campaigns' && (
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
            <div className="flex gap-1 bg-card rounded-lg p-1">
              {(['ALL', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    statusFilter === s ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
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
              className="bg-card border border-border text-sm text-foreground placeholder-muted rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:border-muted"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading && (
            <p className="p-4 text-sm text-muted">Cargando campañas…</p>
          )}
          {!loading && filteredCampaigns.length === 0 && (
            <p className="p-4 text-sm text-muted">
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
      )} {/* end campaigns tab */}

      {/* ── Ads breakdown table ──────────────────────────────────── */}
      {activeTab === 'ads' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex-1">Detalle por anuncio</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <AdsTable adsState={adsState} currency={currency} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
