import { useEffect, useState, useMemo, useRef, useCallback, useReducer, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Eye, MousePointerClick, DollarSign, Target, Megaphone, Activity } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import type { CampaignRow, MarketingState } from '../types'
import { ExportButton } from '../components/reports/ExportButton'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'
import { formatMetaAccountIds, resolveMetaAccountIds } from '../config/metaAccounts'

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const fmtCurrency = (n: number, currency = 'EUR') =>
  n.toLocaleString('es-ES', { style: 'currency', currency, minimumFractionDigits: 2 })

const formatTooltipValue = (value: any, name: string, currency: string) => {
  if (name.includes('%')) {
    return `${Number(value).toFixed(2)}%`
  }
  return fmtCurrency(Number(value), currency)
}

const formatChartTooltip = (value: any, name: string, currency: string) => {
  if (name === 'Gasto') {
    return [`${fmtCurrency(Number(value), currency)}`, `Gasto (${currency})`]
  }
  return [value, name]
}

type AdsState = {
  ads: any[]
  loading: boolean
  loaded: boolean
  error: string | null
}

type AdsAction =
  | { type: 'start' }
  | { type: 'success'; ads: any[] }
  | { type: 'failure'; error: string }

const initialAdsState: AdsState = {
  ads: [],
  loading: false,
  loaded: false,
  error: null,
}

function adsReducer(state: AdsState, action: AdsAction): AdsState {
  switch (action.type) {
    case 'start':
      return { ...state, loading: true, error: null }
    case 'success':
      return { ads: action.ads, loading: false, loaded: true, error: null }
    case 'failure':
      return { ads: [], loading: false, loaded: true, error: action.error }
    default:
      return state
  }
}

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
  accountIds: string[];
}

function CampaignTable({ campaigns, filteredCampaigns, currency, summary, accountIds }: Readonly<CampaignTableProps>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
            <th className="text-left px-4 py-3">Campaña</th>
            <th className="text-left px-3 py-3">Cuenta Meta</th>
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
              <td className="px-3 py-3 text-xs font-semibold text-[#5C5550] whitespace-nowrap">
                {c.accountId ?? formatMetaAccountIds(accountIds)}
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
                {c.insights ? c.insights.impressions.toLocaleString('es-ES') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? c.insights.reach.toLocaleString('es-ES') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {c.insights ? c.insights.clicks.toLocaleString('es-ES') : '—'}
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
                {c.insights ? c.insights.conversions.toLocaleString('es-ES') : '—'}
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
              <td colSpan={4} />
              <td className="px-3 py-3 text-right text-[#28A745]">
                {fmtCurrency(summary?.spend ?? 0, currency)}
              </td>
              <td className="px-3 py-3 text-right">
                {(summary?.impressions ?? 0).toLocaleString('es-ES')}
              </td>
              <td className="px-3 py-3 text-right">
                {(summary?.reach ?? 0).toLocaleString('es-ES')}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {(summary?.clicks ?? 0).toLocaleString('es-ES')}
              </td>
              <td className="px-3 py-3 text-right">{fmt(summary?.ctr ?? 0)}%</td>
              <td className="px-3 py-3 text-right text-[#C49A6C]">{fmtCurrency(summary?.cpc ?? 0, currency)}</td>
              <td className="px-3 py-3 text-right">{fmtCurrency(summary?.cpm ?? 0, currency)}</td>
              <td className="px-3 py-3 text-right text-[#28A745]">
                {(summary?.conversions ?? 0).toLocaleString('es-ES')}
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
  accountId: c.accountId ?? null,
  insights: c.insights ?? null,
})

const buildMarketingParams = (isCustomRange: boolean, customFrom: string, customTo: string, days: number, campaignId?: string) => {
  const p = new URLSearchParams()
  if (isCustomRange) {
    if (customFrom) p.set('from', customFrom)
    p.set('to', customTo || MARKETING_TODAY)
    // If only `to` is provided, the backend uses `days` as the lookback
    // window from `to` to derive `since`.
    if (!customFrom) p.set('days', String(days))
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
  if (statusFilter !== 'ALL' && (c.status ?? '').toUpperCase() !== statusFilter) return false
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

function AdsTable({ adsState, currency, accountIds }: Readonly<{ adsState: any; currency: string; accountIds: string[] }>) {
  if (adsState.loading) {
    return <p className="p-4 text-sm text-muted animate-pulse">Cargando anuncios…</p>
  }
  if (adsState.error) {
    return <p className="p-4 text-sm text-red-400">{adsState.error}</p>
  }
  if (adsState.ads.length === 0) {
    return <p className="p-4 text-sm text-muted">No hay anuncios disponibles para el período seleccionado.</p>
  }

  const noInsights = adsState.ads.length > 0 && adsState.ads.every((ad: any) => !ad.insights || ad.insights.spend === 0)

  return (
    <div className="overflow-x-auto">
      {noInsights && (
        <div className="flex items-start gap-2 px-4 py-3 mx-4 mt-4 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 text-xs">
          <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Meta no permite desglose por anuncio con las credenciales actuales. Solo se muestra gasto agregado a nivel de cuenta/campaña.</span>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted uppercase tracking-wide">
            <th className="text-left px-4 py-3">Anuncio</th>
            <th className="text-left px-3 py-3">Campaña</th>
            <th className="text-left px-3 py-3">Cuenta Meta</th>
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
              <td className="px-3 py-3 text-xs font-semibold text-[#5C5550] whitespace-nowrap">
                {ad.accountId ?? formatMetaAccountIds(accountIds)}
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
                {ad.insights ? ad.insights.impressions.toLocaleString('es-ES') : '—'}
              </td>
              <td className="px-3 py-3 text-right text-foreground">
                {ad.insights ? ad.insights.clicks.toLocaleString('es-ES') : '—'}
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
                {ad.insights ? ad.insights.conversions.toLocaleString('es-ES') : '—'}
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
        const isCustomRange = Boolean(customFrom || customTo)
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

        let accountIds: string[]
        if (Array.isArray(insightsData?.accountIds)) {
          accountIds = insightsData.accountIds
        } else if (Array.isArray(campaignsData?.accountIds)) {
          accountIds = campaignsData.accountIds
        } else {
          accountIds = []
        }
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
  const resolvedAccountIds = resolveMetaAccountIds(accountIds)

  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-4">
      <div className="flex-1">
        <h1 className="text-3xl font-serif font-bold text-foreground">Marketing · Meta Ads</h1>
        <p className="text-muted mt-1 text-sm">
          Período: {loading ? '…' : periodLabel}
          · Moneda: {loading ? '…' : currency}
        </p>
        <MetaAccountsInline
          accountIds={resolvedAccountIds}
          context="Marketing muestra campañas, anuncios y leads de estas cuentas."
          className="mt-3 max-w-2xl"
        />
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
                !customFrom && !customTo && days === d ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
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
  const [activeTab, setActiveTab] = useState<'campaigns' | 'ads' | 'organic'>('campaigns')
  const [adsState, adsDispatch] = useReducer(adsReducer, initialAdsState)

  // ── Organic (Page) data ───────────────────────────────────────────────
  const [organicLoading, setOrganicLoading] = useState(false)
  const [organicError, setOrganicError] = useState<string | null>(null)
  const [organicSummary, setOrganicSummary] = useState<{
    impressions: number; reach: number; engagements: number;
    video_views: number; page_views: number; reactions: number;
  } | null>(null)
  const [organicDaily, setOrganicDaily] = useState<Array<{ date: string; impressions: number; engagements: number; video_views: number; reactions: number }>>([])
  const [organicPosts, setOrganicPosts] = useState<Array<any>>([])
  const [organicKeyword, setOrganicKeyword] = useState('')

  // ── Sub-toggle FB / IG (within Organic tab) ──────────────────────────
  const [organicChannel, setOrganicChannel] = useState<'facebook' | 'instagram'>('facebook')

  // ── Instagram organic data ───────────────────────────────────────────
  const [igLoading, setIgLoading] = useState(false)
  const [igError, setIgError] = useState<string | null>(null)
  const [igSummary, setIgSummary] = useState<{
    reach: number; follower_count_delta: number; profile_views: number;
    accounts_engaged: number; total_interactions: number; website_clicks: number; views: number;
  } | null>(null)
  const [igDaily, setIgDaily] = useState<Array<{ date: string; reach: number; profile_views: number; accounts_engaged: number; total_interactions: number; views: number }>>([])
  const [igPosts, setIgPosts] = useState<Array<any>>([])
  const [igKeyword, setIgKeyword] = useState('')

  const state = useMarketingData(days, campaignId, customFrom, customTo)

  const since2025 = '2025-01-01'
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchAds = useCallback(async () => {
    adsDispatch({ type: 'start' })
    const params = buildMarketingParams(Boolean(customFrom || customTo), customFrom, customTo, days)

    try {
      const data: any = await invokeApi(`/meta/ads?${params}`)
      if (!mountedRef.current) return
      adsDispatch({ type: 'success', ads: data?.ads ?? [] })
    } catch (err: any) {
      if (!mountedRef.current) return
      adsDispatch({ type: 'failure', error: err?.message ?? 'Error cargando anuncios.' })
    }
  }, [customFrom, customTo, days])

  // Fetch ads on demand when ads tab is first opened
  useEffect(() => {
    if (activeTab !== 'ads' || adsState.loaded) return
    fetchAds()
  }, [activeTab, adsState.loaded, fetchAds])

  // ── Fetch organic Page insights (daily series + posts) ────────────────
  const fetchOrganic = useCallback(async (kw: string = '') => {
    setOrganicLoading(true)
    setOrganicError(null)
    try {
      const dailyParams = new URLSearchParams({ days: String(days) }).toString()
      const postsParams = new URLSearchParams({ limit: '50', ...(kw ? { keyword: kw } : {}) }).toString()
      const [dailyRes, postsRes]: any[] = await Promise.all([
        invokeApi(`/meta/organic/daily?${dailyParams}`),
        invokeApi(`/meta/organic/posts?${postsParams}`),
      ])
      if (!mountedRef.current) return
      setOrganicSummary(dailyRes?.summary ?? null)
      setOrganicDaily(Array.isArray(dailyRes?.daily) ? dailyRes.daily : [])
      setOrganicPosts(Array.isArray(postsRes?.posts) ? postsRes.posts : [])
    } catch (err: any) {
      if (!mountedRef.current) return
      setOrganicError(err?.message ?? 'Error cargando datos orgánicos.')
    } finally {
      if (mountedRef.current) setOrganicLoading(false)
    }
  }, [days])

  // Fetch organic on demand + when days change while tab open
  useEffect(() => {
    if (activeTab !== 'organic') return
    if (organicChannel === 'facebook') fetchOrganic(organicKeyword)
    else fetchIg(igKeyword)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, days, organicChannel])

  // ── Fetch Instagram organic insights ──────────────────────────────────
  const fetchIg = useCallback(async (kw: string = '') => {
    setIgLoading(true)
    setIgError(null)
    try {
      const dailyParams = new URLSearchParams({ days: String(days) }).toString()
      const postsParams = new URLSearchParams({ limit: '50', ...(kw ? { keyword: kw } : {}) }).toString()
      const [dailyRes, postsRes]: any[] = await Promise.all([
        invokeApi(`/meta/ig/daily?${dailyParams}`),
        invokeApi(`/meta/ig/posts?${postsParams}`),
      ])
      if (!mountedRef.current) return
      setIgSummary(dailyRes?.summary ?? null)
      setIgDaily(Array.isArray(dailyRes?.daily) ? dailyRes.daily : [])
      setIgPosts(Array.isArray(postsRes?.posts) ? postsRes.posts : [])
    } catch (err: any) {
      if (!mountedRef.current) return
      setIgError(err?.message ?? 'Error cargando datos de Instagram.')
    } finally {
      if (mountedRef.current) setIgLoading(false)
    }
  }, [days])

  const { summary, changes, daily, campaigns, currency, accountIds, period, loading, error } = state
  const resolvedAccountIds = resolveMetaAccountIds(accountIds)

  const effectiveCampaignId = useMemo(() => {
    if (campaignId === 'ALL') return 'ALL'
    return state.campaigns.some((c) => c.id === campaignId) ? campaignId : 'ALL'
  }, [campaignId, state.campaigns])

  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE').length

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => filterCampaign(c, effectiveCampaignId, statusFilter, search))
  }, [campaigns, effectiveCampaignId, statusFilter, search])

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
        accountIds={resolvedAccountIds}
        currency={currency}
        campaigns={campaigns}
        campaignId={effectiveCampaignId}
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
          value={loading ? '…' : (summary?.impressions ?? 0).toLocaleString('es-ES')}
          sub={`Alcance: ${(summary?.reach ?? 0).toLocaleString('es-ES')}`}
          icon={<Eye className="w-4 h-4 text-sky-400" />}
          color="text-sky-400"
          delta={changes?.impressions}
        />
        <StatCard
          label="Clics"
          value={loading ? '…' : (summary?.clicks ?? 0).toLocaleString('es-ES')}
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
          value={loading ? '…' : (summary?.reach ?? 0).toLocaleString('es-ES')}
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
                  formatter={(value: any, name: string) => formatChartTooltip(value, name, currency)}
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
                  formatter={(value: any, name: string) => [formatTooltipValue(value, name, currency), name]}
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

      {/* ── Tab switcher: Campañas / Anuncios / Orgánico ──────────── */}
      <div className="flex gap-1 bg-card border border-border rounded-lg p-1 w-fit">
        {(['campaigns', 'ads', 'organic'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            {{ campaigns: 'Campañas', ads: 'Por anuncio', organic: 'Orgánico' }[tab]}
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
            <div className="p-4 flex items-center gap-3">
              <p className="text-sm text-muted">
                {campaigns.length === 0
                  ? 'No hay campañas disponibles para el período seleccionado.'
                  : `Ninguna campaña coincide con los filtros actuales${statusFilter !== 'ALL' ? ` (estado: ${STATUS_LABELS[statusFilter as keyof typeof STATUS_LABELS] ?? statusFilter})` : ''}.`}
              </p>
              {campaigns.length > 0 && (statusFilter !== 'ALL' || search || campaignId !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => { setStatusFilter('ALL'); setSearch(''); setCampaignId('ALL') }}
                  className="shrink-0 text-xs text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Mostrar todas
                </button>
              )}
            </div>
          )}
          {!loading && filteredCampaigns.length > 0 && (
            <CampaignTable
              campaigns={campaigns}
              filteredCampaigns={filteredCampaigns}
              currency={currency}
              summary={summary}
              accountIds={resolvedAccountIds}
            />
          )}
        </CardContent>
      </Card>
      )} {/* end campaigns tab */}

      {/* ── Ads breakdown table ──────────────────────────────────── */}
      {activeTab === 'ads' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3">
              <CardTitle className="flex-1">Detalle por anuncio</CardTitle>
              <MetaAccountsInline accountIds={resolvedAccountIds} context="Desglose por anuncio de las cuentas Meta conectadas." />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <AdsTable adsState={adsState} currency={currency} accountIds={resolvedAccountIds} />
          </CardContent>
        </Card>
      )}

      {activeTab === 'organic' && (
        <div className="space-y-4">
          {/* Sub-toggle: Facebook / Instagram */}
          <MetaAccountsInline accountIds={resolvedAccountIds} context="Orgánico Meta conectado al mismo ecosistema de campañas y leads." />
          <div className="flex gap-2">
            {([
              { id: 'facebook', label: 'Facebook Page' },
              { id: 'instagram', label: 'Instagram' },
            ] as const).map((c) => (
              <button
                key={c.id}
                onClick={() => setOrganicChannel(c.id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  organicChannel === c.id
                    ? 'bg-primary/25 text-foreground'
                    : 'bg-card/40 text-muted hover:bg-card/60'
                }`}
              >{c.label}</button>
            ))}
          </div>

          {organicChannel === 'facebook' && (
          <>
          {organicError && (
            <Card><CardContent className="p-4 text-sm text-red-400">{organicError}</CardContent></Card>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Alcance único', value: organicSummary?.reach ?? 0 },
              { label: 'Interacciones', value: organicSummary?.engagements ?? 0 },
              { label: 'Vistas página', value: organicSummary?.page_views ?? 0 },
              { label: 'Vistas video', value: organicSummary?.video_views ?? 0 },
              { label: 'Reacciones', value: organicSummary?.reactions ?? 0 },
              { label: 'Posts (90d)', value: organicPosts.length },
            ].map((m) => (
              <Card key={m.label}>
                <CardContent className="p-3">
                  <div className="text-xs text-muted">{m.label}</div>
                  <div className="text-xl font-semibold text-foreground mt-1">
                    {organicLoading ? '…' : Number(m.value).toLocaleString('es-ES')}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Daily area chart */}
          <Card>
            <CardHeader><CardTitle>Tendencia orgánica diaria</CardTitle></CardHeader>
            <CardContent style={{ height: 260 }}>
              {organicLoading && <p className="text-sm text-muted">Cargando…</p>}
              {!organicLoading && organicDaily.length === 0 && (
                <p className="text-sm text-muted">Sin datos en el período seleccionado.</p>
              )}
              {!organicLoading && organicDaily.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={organicDaily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="date" stroke="#8a8a8a" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#8a8a8a" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="impressions" name="Alcance" stroke="#9F8A75" fill="#9F8A7544" />
                    <Area type="monotone" dataKey="engagements" name="Interacciones" stroke="#7A7573" fill="#7A757344" />
                    <Area type="monotone" dataKey="video_views" name="Video views" stroke="#C9B498" fill="#C9B49844" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Posts table with keyword filter */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <CardTitle className="flex-1">Posts orgánicos (top 50)</CardTitle>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Filtrar por palabra (ej. co2)…"
                    value={organicKeyword}
                    onChange={(e) => setOrganicKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchOrganic(organicKeyword) }}
                    className="bg-card border border-border text-sm text-foreground placeholder-muted rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-muted"
                  />
                  <button
                    onClick={() => fetchOrganic(organicKeyword)}
                    className="px-3 py-1.5 rounded-lg bg-primary/15 text-foreground text-sm hover:bg-primary/25"
                  >Filtrar</button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {organicLoading && <p className="p-4 text-sm text-muted">Cargando posts…</p>}
              {!organicLoading && organicPosts.length === 0 && (
                <p className="p-4 text-sm text-muted">Sin posts.</p>
              )}
              {!organicLoading && organicPosts.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-card/40 text-xs text-muted">
                    <tr>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Mensaje</th>
                      <th className="text-left px-3 py-2">Tipo</th>
                      <th className="text-right px-3 py-2">Alcance</th>
                      <th className="text-right px-3 py-2">Interacc.</th>
                      <th className="text-right px-3 py-2">Reacc.</th>
                      <th className="text-right px-3 py-2">Video views</th>
                      <th className="text-left px-3 py-2">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organicPosts.map((p) => (
                      <tr key={p.post_id} className="border-t border-border/50">
                        <td className="px-3 py-2 whitespace-nowrap text-muted">
                          {p.created_time ? new Date(p.created_time).toISOString().slice(0, 10) : '—'}
                        </td>
                        <td className="px-3 py-2 max-w-md truncate" title={p.message ?? ''}>
                          {p.message ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted">{p.is_video ? 'Video' : (p.status_type ?? '—')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.reach || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.engaged_users || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.reactions || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.video_views || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2">
                          {p.permalink_url
                            ? <a href={p.permalink_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Ver</a>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          </>
          )}

          {organicChannel === 'instagram' && (
          <>
          {igError && (
            <Card><CardContent className="p-4 text-sm text-red-400">{igError}</CardContent></Card>
          )}

          {/* IG Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Alcance', value: igSummary?.reach ?? 0 },
              { label: 'Interacciones', value: igSummary?.total_interactions ?? 0 },
              { label: 'Visitas perfil', value: igSummary?.profile_views ?? 0 },
              { label: 'Cuentas activadas', value: igSummary?.accounts_engaged ?? 0 },
              { label: 'Clicks web', value: igSummary?.website_clicks ?? 0 },
              { label: 'Δ Seguidores', value: igSummary?.follower_count_delta ?? 0 },
            ].map((m) => (
              <Card key={m.label}>
                <CardContent className="p-3">
                  <div className="text-xs text-muted">{m.label}</div>
                  <div className="text-xl font-semibold text-foreground mt-1">
                    {igLoading ? '…' : Number(m.value).toLocaleString('es-ES')}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* IG daily chart */}
          <Card>
            <CardHeader><CardTitle>Tendencia diaria · Instagram</CardTitle></CardHeader>
            <CardContent style={{ height: 260 }}>
              {igLoading && <p className="text-sm text-muted">Cargando…</p>}
              {!igLoading && igDaily.length === 0 && (
                <p className="text-sm text-muted">Sin datos en el período seleccionado.</p>
              )}
              {!igLoading && igDaily.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={igDaily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                    <XAxis dataKey="date" stroke="#8a8a8a" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#8a8a8a" tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="reach" name="Alcance" stroke="#9F8A75" fill="#9F8A7544" />
                    <Area type="monotone" dataKey="total_interactions" name="Interacciones" stroke="#7A7573" fill="#7A757344" />
                    <Area type="monotone" dataKey="profile_views" name="Visitas perfil" stroke="#C9B498" fill="#C9B49844" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* IG posts table */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <CardTitle className="flex-1">Posts Instagram (top 50)</CardTitle>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Filtrar caption…"
                    value={igKeyword}
                    onChange={(e) => setIgKeyword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchIg(igKeyword) }}
                    className="bg-card border border-border text-sm text-foreground placeholder-muted rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:border-muted"
                  />
                  <button
                    onClick={() => fetchIg(igKeyword)}
                    className="px-3 py-1.5 rounded-lg bg-primary/15 text-foreground text-sm hover:bg-primary/25"
                  >Filtrar</button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {igLoading && <p className="p-4 text-sm text-muted">Cargando posts…</p>}
              {!igLoading && igPosts.length === 0 && (
                <p className="p-4 text-sm text-muted">Sin posts.</p>
              )}
              {!igLoading && igPosts.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-card/40 text-xs text-muted">
                    <tr>
                      <th className="text-left px-3 py-2">Fecha</th>
                      <th className="text-left px-3 py-2">Caption</th>
                      <th className="text-left px-3 py-2">Tipo</th>
                      <th className="text-right px-3 py-2">Alcance</th>
                      <th className="text-right px-3 py-2">Likes</th>
                      <th className="text-right px-3 py-2">Coment.</th>
                      <th className="text-right px-3 py-2">Saves</th>
                      <th className="text-right px-3 py-2">Views</th>
                      <th className="text-left px-3 py-2">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {igPosts.map((p) => (
                      <tr key={p.media_id} className="border-t border-border/50">
                        <td className="px-3 py-2 whitespace-nowrap text-muted">
                          {p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : '—'}
                        </td>
                        <td className="px-3 py-2 max-w-md truncate" title={p.caption ?? ''}>
                          {p.caption ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-muted">{p.media_product_type ?? p.media_type ?? '—'}</td>
                        <td className="px-3 py-2 text-right">{Number(p.reach || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.likes || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.comments || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.saved || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right">{Number(p.views || 0).toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2">
                          {p.permalink
                            ? <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-primary underline">Ver</a>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          </>
          )}
        </div>
      )}
    </div>
  )
}
