import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BarChart3, DollarSign, Eye, MousePointerClick, Search, Target, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invokeApi } from '../lib/invokeApi'
import MetaMarketing from './Marketing'

type Provider = 'meta' | 'google'

type GoogleSummary = {
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpc: number
  cpm: number
  cpp: number | null
}

type GoogleChanges = Partial<Record<'impressions' | 'clicks' | 'spend' | 'conversions', number>>

type GoogleInsightsResponse = {
  success: boolean
  message?: string
  noServiceAccount?: boolean
  notConnected?: boolean
  noAccountId?: boolean
  period?: { since: string; until: string; days: number }
  summary?: GoogleSummary
  changes?: GoogleChanges
}

type GoogleCampaign = {
  id: string
  name: string
  status: string
  type: string
  budget: number | null
  insights: {
    impressions: number
    clicks: number
    spend: number
    conversions: number
    ctr: number
    cpc: number | null
    cpp: number | null
  }
}

type GoogleCampaignsResponse = {
  success: boolean
  message?: string
  campaigns?: GoogleCampaign[]
}

type GoogleState = {
  summary: GoogleSummary | null
  changes: GoogleChanges
  campaigns: GoogleCampaign[]
  period: GoogleInsightsResponse['period'] | null
  loading: boolean
  error: string | null
}

const fmtMoneyAmount = (value: number | null | undefined) =>
  Number(value ?? 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtNumber = (value: number | null | undefined, decimals = 0) =>
  Number(value ?? 0).toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const firstDayOfCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function Delta({ value }: Readonly<{ value?: number }>) {
  if (value == null || !Number.isFinite(value) || value === 0) return null
  return (
    <span className={`ml-2 text-xs font-semibold ${value > 0 ? 'text-[#28A745]' : 'text-[#D9534F]'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  delta,
}: Readonly<{ label: string; value: string; detail?: string; icon: ReactNode; delta?: number }>) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
            <div className="mt-1 flex items-center">
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <Delta value={delta} />
            </div>
            {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
          </div>
          <div className="rounded-lg bg-card p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function GoogleAdsPanel() {
  const [from, setFrom] = useState(firstDayOfCurrentMonth)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [query, setQuery] = useState('')
  const requestSequenceRef = useRef(0)
  const [state, setState] = useState<GoogleState>({
    summary: null,
    changes: {},
    campaigns: [],
    period: null,
    loading: true,
    error: null,
  })

  const load = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const params = new URLSearchParams({ from, to }).toString()
    try {
      const [insights, campaigns] = await Promise.all([
        invokeApi<GoogleInsightsResponse>(`/api/google-ads/insights?${params}`),
        invokeApi<GoogleCampaignsResponse>(`/api/google-ads/campaigns?${params}`),
      ])

      if (!insights.success) {
        throw new Error(insights.message || 'Google Ads no está disponible.')
      }
      if (!campaigns.success) {
        throw new Error(campaigns.message || 'No se pudieron cargar las campañas de Google Ads.')
      }
      if (requestSequence !== requestSequenceRef.current) return

      setState({
        summary: insights.summary ?? null,
        changes: insights.changes ?? {},
        campaigns: Array.isArray(campaigns.campaigns) ? campaigns.campaigns : [],
        period: insights.period ?? null,
        loading: false,
        error: null,
      })
    } catch (error: unknown) {
      if (requestSequence !== requestSequenceRef.current) return
      const message = error instanceof Error ? error.message : 'Error cargando Google Ads.'
      setState((prev) => ({ ...prev, loading: false, error: message }))
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const filteredCampaigns = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return state.campaigns
    return state.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(normalized))
  }, [query, state.campaigns])

  const activeCampaignsLoaded = state.campaigns.filter((campaign) => campaign.status === 'ENABLED').length
  const periodLabel = state.period
    ? `${state.period.since} → ${state.period.until}`
    : `${from} → ${to}`
  const hasSummaryConversions = Number(state.summary?.conversions ?? 0) > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Marketing · Google Ads</h1>
          <p className="mt-1 text-sm text-muted">Datos directos de Google Ads · {periodLabel}</p>
          <p className="mt-1 text-xs text-muted">Los importes se muestran en la moneda configurada en la cuenta de Google Ads.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Fecha inicial Google Ads"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          />
          <span className="text-xs text-muted">→</span>
          <input
            aria-label="Fecha final Google Ads"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
          >
            Actualizar
          </button>
        </div>
      </div>

      {state.error && (
        <div className="rounded-lg border border-[#D9534F]/30 bg-[#D9534F]/8 px-4 py-3 text-sm text-[#D9534F]">
          {state.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Gasto total"
          value={state.loading ? '…' : fmtMoneyAmount(state.summary?.spend)}
          detail={`${periodLabel} · moneda de la cuenta`}
          icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
          delta={state.changes.spend}
        />
        <MetricCard
          label="Impresiones"
          value={state.loading ? '…' : fmtNumber(state.summary?.impressions)}
          icon={<Eye className="h-4 w-4 text-sky-500" />}
          delta={state.changes.impressions}
        />
        <MetricCard
          label="Clics"
          value={state.loading ? '…' : fmtNumber(state.summary?.clicks)}
          detail={`CTR: ${fmtNumber(state.summary?.ctr, 2)}%`}
          icon={<MousePointerClick className="h-4 w-4 text-violet-500" />}
          delta={state.changes.clicks}
        />
        <MetricCard
          label="Conversiones"
          value={state.loading ? '…' : fmtNumber(state.summary?.conversions, 2)}
          detail={`CPP: ${hasSummaryConversions && state.summary?.cpp != null ? fmtMoneyAmount(state.summary.cpp) : '—'}`}
          icon={<TrendingUp className="h-4 w-4 text-lime-500" />}
          delta={state.changes.conversions}
        />
        <MetricCard
          label="CPC promedio"
          value={state.loading ? '…' : fmtMoneyAmount(state.summary?.cpc)}
          detail={`CPM: ${fmtMoneyAmount(state.summary?.cpm)} · moneda de la cuenta`}
          icon={<Target className="h-4 w-4 text-amber-500" />}
        />
        <MetricCard
          label="Campañas activas cargadas"
          value={state.loading ? '…' : String(activeCampaignsLoaded)}
          detail={`${state.campaigns.length} campañas cargadas · máximo 50 por consulta`}
          icon={<BarChart3 className="h-4 w-4 text-rose-500" />}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <CardTitle className="flex-1">Campañas Google Ads</CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar campaña…"
                className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {state.loading && <p className="p-4 text-sm text-muted">Cargando campañas de Google Ads…</p>}
          {!state.loading && !state.error && filteredCampaigns.length === 0 && (
            <p className="p-4 text-sm text-muted">No hay campañas para el período seleccionado.</p>
          )}
          {!state.loading && filteredCampaigns.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 text-left">Campaña</th>
                    <th className="px-3 py-3 text-center">Estado</th>
                    <th className="px-3 py-3 text-center">Tipo</th>
                    <th className="px-3 py-3 text-right">Presupuesto</th>
                    <th className="px-3 py-3 text-right">Gasto</th>
                    <th className="px-3 py-3 text-right">Impresiones</th>
                    <th className="px-3 py-3 text-right">Clics</th>
                    <th className="px-3 py-3 text-right">CTR</th>
                    <th className="px-3 py-3 text-right">CPC</th>
                    <th className="px-3 py-3 text-right">Conversiones</th>
                    <th className="px-3 py-3 text-right">CPP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredCampaigns.map((campaign) => (
                    <tr key={campaign.id} className="hover:bg-card/40">
                      <td className="max-w-[280px] px-4 py-3 font-medium text-foreground">
                        <span className="block truncate" title={campaign.name}>{campaign.name}</span>
                      </td>
                      <td className="px-3 py-3 text-center text-xs">{campaign.status || '—'}</td>
                      <td className="px-3 py-3 text-center text-xs text-muted">{campaign.type || '—'}</td>
                      <td className="px-3 py-3 text-right">{campaign.budget == null ? '—' : fmtMoneyAmount(campaign.budget)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-[#28A745]">{fmtMoneyAmount(campaign.insights.spend)}</td>
                      <td className="px-3 py-3 text-right">{fmtNumber(campaign.insights.impressions)}</td>
                      <td className="px-3 py-3 text-right">{fmtNumber(campaign.insights.clicks)}</td>
                      <td className="px-3 py-3 text-right">{fmtNumber(campaign.insights.ctr, 2)}%</td>
                      <td className="px-3 py-3 text-right">{campaign.insights.cpc == null ? '—' : fmtMoneyAmount(campaign.insights.cpc)}</td>
                      <td className="px-3 py-3 text-right">{fmtNumber(campaign.insights.conversions, 2)}</td>
                      <td className="px-3 py-3 text-right">{campaign.insights.conversions > 0 && campaign.insights.cpp != null ? fmtMoneyAmount(campaign.insights.cpp) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function MarketingUnified() {
  const [provider, setProvider] = useState<Provider>('meta')

  return (
    <div className="space-y-5">
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => setProvider('meta')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            provider === 'meta' ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          Meta Ads
        </button>
        <button
          type="button"
          onClick={() => setProvider('google')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            provider === 'google' ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'
          }`}
        >
          Google Ads
        </button>
      </div>

      {provider === 'meta' ? <MetaMarketing /> : <GoogleAdsPanel />}
    </div>
  )
}
