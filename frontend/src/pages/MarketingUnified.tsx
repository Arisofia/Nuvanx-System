import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BarChart3, DollarSign, Eye, MousePointerClick, Search, Target, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { invokeApi } from '../lib/invokeApi'
import type { CampaignRow } from '../types'

type Provider = 'meta' | 'google'
type ProviderPeriod = { since: string; until: string; days: number }

type MetaSummary = {
  impressions: number
  reach: number
  clicks: number
  spend: number
  conversions: number
  messagingConversationStarted?: number
  ctr: number
  cpc: number
  cpm: number
  cpp: number | null
}

type MetaInsightsResponse = {
  success?: boolean
  summary?: MetaSummary
  changes?: Partial<Record<'impressions' | 'reach' | 'clicks' | 'spend' | 'conversions', number>>
  period?: ProviderPeriod
  currency?: string
  accountId?: string
  accountIds?: string[]
}

type MetaCampaignsResponse = {
  success?: boolean
  campaigns?: CampaignRow[]
  currency?: string
  accountId?: string
  accountIds?: string[]
}

type MetaAd = {
  id: string
  name: string
  status?: string
  campaignName?: string | null
  adsetName?: string | null
  accountId?: string | null
  insights?: {
    impressions?: number
    reach?: number
    clicks?: number
    spend?: number
    ctr?: number
    cpc?: number
    cpm?: number
    conversions?: number
    cpp?: number | null
  } | null
}

type MetaAdsResponse = { success?: boolean; ads?: MetaAd[] }

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
  period?: ProviderPeriod
  summary?: GoogleSummary
  changes?: GoogleChanges
  currency?: string | null
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
  currency?: string | null
}

type GoogleStatusResponse = {
  success: boolean
  connected: boolean
  status: string
  customerId: string | null
  credentialPresent: boolean
  credentialLastUsed: string | null
  lastSync: string | null
  lastErrorPresent: boolean
  currency?: string | null
}

const fmtMoney = (value: number | null | undefined, currency: string | null | undefined) => {
  if (value == null || !Number.isFinite(Number(value)) || !currency) return '—'
  return Number(value).toLocaleString('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const fmtNumber = (value: number | null | undefined, decimals = 0) =>
  Number(value ?? 0).toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const firstDayOfCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function Delta({ value }: Readonly<{ value?: number }>) {
  if (value == null || !Number.isFinite(value) || value === 0) return null
  return <span className={`ml-2 text-xs font-semibold ${value > 0 ? 'text-[#28A745]' : 'text-[#D9534F]'}`}>{value > 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%</span>
}

function MetricCard({ label, value, detail, icon, delta }: Readonly<{
  label: string
  value: string
  detail?: string
  icon: ReactNode
  delta?: number
}>) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
            <div className="mt-1 flex items-center"><p className="text-2xl font-bold text-foreground">{value}</p><Delta value={delta} /></div>
            {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
          </div>
          <div className="rounded-lg bg-card p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function DateControls({ from, to, setFrom, setTo, refresh, provider }: Readonly<{
  from: string
  to: string
  setFrom: (value: string) => void
  setTo: (value: string) => void
  refresh: () => void
  provider: string
}>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label={`Fecha inicial ${provider}`} type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground" />
      <span className="text-xs text-muted">→</span>
      <input aria-label={`Fecha final ${provider}`} type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground" />
      <button type="button" onClick={refresh} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface">Actualizar</button>
    </div>
  )
}

function MetaAdsPanel() {
  const [from, setFrom] = useState(firstDayOfCurrentMonth)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [query, setQuery] = useState('')
  const sequence = useRef(0)
  const [state, setState] = useState<{
    summary: MetaSummary | null
    changes: MetaInsightsResponse['changes']
    campaigns: CampaignRow[]
    ads: MetaAd[]
    accountIds: string[]
    currency: string | null
    period: ProviderPeriod | null
    loading: boolean
    error: string | null
  }>({ summary: null, changes: {}, campaigns: [], ads: [], accountIds: [], currency: null, period: null, loading: true, error: null })

  const load = useCallback(async () => {
    const requestId = ++sequence.current
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const params = new URLSearchParams({ from, to }).toString()
    try {
      const [insights, campaigns, ads] = await Promise.all([
        invokeApi<MetaInsightsResponse>(`/api/meta/insights?${params}`),
        invokeApi<MetaCampaignsResponse>(`/api/meta/campaigns?${params}`),
        invokeApi<MetaAdsResponse>(`/api/meta/ads?${params}`),
      ])
      if (requestId !== sequence.current) return
      const accountIds = [...new Set([...(insights.accountIds ?? []), ...(campaigns.accountIds ?? []), insights.accountId, campaigns.accountId].filter((value): value is string => Boolean(value)))]
      setState({
        summary: insights.summary ?? null,
        changes: insights.changes ?? {},
        campaigns: Array.isArray(campaigns.campaigns) ? campaigns.campaigns : [],
        ads: Array.isArray(ads.ads) ? ads.ads : [],
        accountIds,
        currency: insights.currency ?? campaigns.currency ?? null,
        period: insights.period ?? null,
        loading: false,
        error: null,
      })
    } catch (error: unknown) {
      if (requestId !== sequence.current) return
      setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Error cargando Meta Ads.' }))
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  const filteredCampaigns = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? state.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(normalized)) : state.campaigns
  }, [query, state.campaigns])
  const periodLabel = state.period ? `${state.period.since} → ${state.period.until}` : `${from} → ${to}`
  const summary = state.summary
  const hasSummaryConversions = Number(summary?.conversions ?? 0) > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-3xl font-serif font-bold text-foreground">Marketing · Meta Ads</h1><p className="mt-1 text-sm text-muted">Datos directos de Meta · {periodLabel}</p><p className="mt-1 text-xs text-muted">Cuentas: {state.accountIds.length > 0 ? state.accountIds.join(' · ') : 'sin cuenta resuelta'} · moneda {state.currency ?? 'no verificada'}</p></div>
        <DateControls from={from} to={to} setFrom={setFrom} setTo={setTo} refresh={() => void load()} provider="Meta Ads" />
      </div>
      {state.error && <div className="rounded-lg border border-[#D9534F]/30 bg-[#D9534F]/8 px-4 py-3 text-sm text-[#D9534F]">{state.error}</div>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Gasto" value={state.loading ? '…' : fmtMoney(summary?.spend, state.currency)} icon={<DollarSign className="h-4 w-4 text-emerald-500" />} delta={state.changes?.spend} />
        <MetricCard label="Impresiones" value={state.loading ? '…' : fmtNumber(summary?.impressions)} icon={<Eye className="h-4 w-4 text-sky-500" />} delta={state.changes?.impressions} />
        <MetricCard label="Alcance" value={state.loading ? '…' : fmtNumber(summary?.reach)} icon={<Eye className="h-4 w-4 text-indigo-500" />} delta={state.changes?.reach} />
        <MetricCard label="Clics" value={state.loading ? '…' : fmtNumber(summary?.clicks)} detail={`CTR ${fmtNumber(summary?.ctr, 2)}%`} icon={<MousePointerClick className="h-4 w-4 text-violet-500" />} delta={state.changes?.clicks} />
        <MetricCard label="Conversiones Meta" value={state.loading ? '…' : fmtNumber(summary?.conversions, 2)} detail="Proveedor · no equivale a cliente nuevo" icon={<TrendingUp className="h-4 w-4 text-lime-500" />} delta={state.changes?.conversions} />
        <MetricCard label="CPC promedio" value={state.loading ? '…' : fmtMoney(summary?.cpc, state.currency)} detail={`CPM ${fmtMoney(summary?.cpm, state.currency)}`} icon={<Target className="h-4 w-4 text-amber-500" />} />
        <MetricCard label="CPP proveedor" value={state.loading || !hasSummaryConversions ? '—' : fmtMoney(summary?.cpp, state.currency)} detail={hasSummaryConversions ? 'Gasto / conversiones Meta' : 'Sin conversiones en el período'} icon={<Target className="h-4 w-4 text-rose-500" />} />
      </div>

      <Card>
        <CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><CardTitle className="flex-1">Campañas Meta</CardTitle><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar campaña…" className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted" /></div></div></CardHeader>
        <CardContent className="p-0">
          {state.loading && <p className="p-4 text-sm text-muted">Cargando campañas Meta…</p>}
          {!state.loading && !state.error && filteredCampaigns.length === 0 && <p className="p-4 text-sm text-muted">No hay campañas para el período seleccionado.</p>}
          {!state.loading && filteredCampaigns.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-xs uppercase tracking-wide text-muted"><th className="px-4 py-3 text-left">Campaña</th><th className="px-3 py-3 text-center">Cuenta</th><th className="px-3 py-3 text-center">Estado</th><th className="px-3 py-3 text-right">Gasto</th><th className="px-3 py-3 text-right">Impresiones</th><th className="px-3 py-3 text-right">Alcance</th><th className="px-3 py-3 text-right">Clics</th><th className="px-3 py-3 text-right">CTR</th><th className="px-3 py-3 text-right">Conversiones</th><th className="px-3 py-3 text-right">CPP</th></tr></thead><tbody className="divide-y divide-border">{filteredCampaigns.map((campaign) => <tr key={`${campaign.accountId ?? 'meta'}-${campaign.id}`}><td className="px-4 py-3 font-medium">{campaign.name}</td><td className="px-3 py-3 text-center text-xs">{campaign.accountId ?? '—'}</td><td className="px-3 py-3 text-center text-xs">{campaign.status}</td><td className="px-3 py-3 text-right">{campaign.insights ? fmtMoney(campaign.insights.spend, state.currency) : '—'}</td><td className="px-3 py-3 text-right">{campaign.insights ? fmtNumber(campaign.insights.impressions) : '—'}</td><td className="px-3 py-3 text-right">{campaign.insights ? fmtNumber(campaign.insights.reach) : '—'}</td><td className="px-3 py-3 text-right">{campaign.insights ? fmtNumber(campaign.insights.clicks) : '—'}</td><td className="px-3 py-3 text-right">{campaign.insights ? `${fmtNumber(campaign.insights.ctr, 2)}%` : '—'}</td><td className="px-3 py-3 text-right">{campaign.insights ? fmtNumber(campaign.insights.conversions, 2) : '—'}</td><td className="px-3 py-3 text-right">{campaign.insights && campaign.insights.conversions > 0 ? fmtMoney(campaign.insights.cpp, state.currency) : '—'}</td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle>Anuncios Meta cargados</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{state.loading ? '…' : state.ads.length.toLocaleString('es-ES')}</p><p className="mt-1 text-xs text-muted">Inventario devuelto por `/api/meta/ads` para el período. Creatives, ad sets y media-level insights se incorporarán en Meta 360.</p></CardContent></Card>
    </div>
  )
}

function GoogleAdsPanel() {
  const [from, setFrom] = useState(firstDayOfCurrentMonth)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [query, setQuery] = useState('')
  const requestSequenceRef = useRef(0)
  const [state, setState] = useState<{
    connection: GoogleStatusResponse | null
    summary: GoogleSummary | null
    changes: GoogleChanges
    campaigns: GoogleCampaign[]
    currency: string | null
    period: ProviderPeriod | null
    loading: boolean
    error: string | null
  }>({ connection: null, summary: null, changes: {}, campaigns: [], currency: null, period: null, loading: true, error: null })

  const load = useCallback(async () => {
    const requestSequence = ++requestSequenceRef.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const params = new URLSearchParams({ from, to }).toString()
    try {
      const [connection, insights, campaigns] = await Promise.all([
        invokeApi<GoogleStatusResponse>('/api/google-ads/status'),
        invokeApi<GoogleInsightsResponse>(`/api/google-ads/insights?${params}`),
        invokeApi<GoogleCampaignsResponse>(`/api/google-ads/campaigns?${params}`),
      ])
      if (requestSequence !== requestSequenceRef.current) return
      setState((prev) => ({ ...prev, connection }))
      if (!connection.success) throw new Error('No se pudo comprobar el estado de Google Ads.')
      if (!insights.success) throw new Error(insights.message || 'Google Ads no está disponible.')
      if (!campaigns.success) throw new Error(campaigns.message || 'No se pudieron cargar las campañas de Google Ads.')
      setState({
        connection,
        summary: insights.summary ?? null,
        changes: insights.changes ?? {},
        campaigns: campaigns.campaigns ?? [],
        currency: insights.currency ?? campaigns.currency ?? connection.currency ?? null,
        period: insights.period ?? null,
        loading: false,
        error: null,
      })
    } catch (error: unknown) {
      if (requestSequence !== requestSequenceRef.current) return
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : 'Error cargando Google Ads.' }))
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  const filteredCampaigns = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? state.campaigns.filter((campaign) => campaign.name.toLowerCase().includes(normalized)) : state.campaigns
  }, [query, state.campaigns])
  const activeCampaignsLoaded = state.campaigns.filter((campaign) => campaign.status === 'ENABLED' || campaign.status === 'ACTIVE').length
  const periodLabel = state.period ? `${state.period.since} → ${state.period.until}` : `${from} → ${to}`
  const hasSummaryConversions = Number(state.summary?.conversions ?? 0) > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-serif font-bold text-foreground">Marketing · Google Ads</h1><p className="mt-1 text-sm text-muted">Datos directos de Google Ads · {periodLabel}</p></div><DateControls from={from} to={to} setFrom={setFrom} setTo={setTo} refresh={() => void load()} provider="Google Ads" /></div>
      {state.error && <div className="rounded-lg border border-[#D9534F]/30 bg-[#D9534F]/8 px-4 py-3 text-sm text-[#D9534F]">{state.error}</div>}
      {state.connection && <div data-testid="google-ads-connection-status" className="rounded-lg border border-border bg-card px-4 py-3"><p className="text-sm font-semibold">{state.connection.connected ? 'Conexión Google Ads operativa' : 'Conexión Google Ads incompleta'}</p><p className="mt-1 text-xs text-muted">Customer ID: {state.connection.customerId ?? 'no configurado'} · credencial {state.connection.credentialPresent ? 'configurada' : 'ausente'} · último uso {state.connection.credentialLastUsed ? new Date(state.connection.credentialLastUsed).toLocaleString('es-ES') : 'sin uso registrado'} · sync {state.connection.lastSync ? new Date(state.connection.lastSync).toLocaleString('es-ES') : 'sin sincronización'} · {state.currency ? `moneda ${state.currency}` : 'moneda configurada en la cuenta de Google Ads todavía no verificada por este endpoint'}</p></div>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard label="Gasto" value={state.loading ? '…' : fmtMoney(state.summary?.spend, state.currency)} icon={<DollarSign className="h-4 w-4 text-emerald-500" />} delta={state.changes.spend} />
        <MetricCard label="Impresiones" value={state.loading ? '…' : fmtNumber(state.summary?.impressions)} icon={<Eye className="h-4 w-4 text-sky-500" />} delta={state.changes.impressions} />
        <MetricCard label="Clics" value={state.loading ? '…' : fmtNumber(state.summary?.clicks)} detail={`CTR ${fmtNumber(state.summary?.ctr, 2)}%`} icon={<MousePointerClick className="h-4 w-4 text-violet-500" />} delta={state.changes.clicks} />
        <MetricCard label="Conversiones Google" value={state.loading ? '…' : fmtNumber(state.summary?.conversions, 2)} detail="Proveedor · no equivale a cliente nuevo" icon={<TrendingUp className="h-4 w-4 text-lime-500" />} delta={state.changes.conversions} />
        <MetricCard label="CPC promedio" value={state.loading ? '…' : fmtMoney(state.summary?.cpc, state.currency)} detail={state.currency ? `CPM ${fmtMoney(state.summary?.cpm, state.currency)}` : 'Moneda no verificada'} icon={<Target className="h-4 w-4 text-amber-500" />} />
        <MetricCard label="CPP proveedor" value={state.loading || !hasSummaryConversions ? '—' : fmtMoney(state.summary?.cpp, state.currency)} detail={hasSummaryConversions ? 'Gasto / conversiones Google' : 'Sin conversiones en el período'} icon={<Target className="h-4 w-4 text-orange-500" />} />
        <MetricCard label="Campañas activas cargadas" value={state.loading ? '…' : String(activeCampaignsLoaded)} detail="máximo 50 por consulta; no representa necesariamente el total de la cuenta" icon={<BarChart3 className="h-4 w-4 text-rose-500" />} />
      </div>
      <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><CardTitle className="flex-1">Campañas Google Ads</CardTitle><div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar campaña…" className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm" /></div></div></CardHeader><CardContent className="p-0">{state.loading && <p className="p-4 text-sm text-muted">Cargando campañas Google Ads…</p>}{!state.loading && !state.error && filteredCampaigns.length === 0 && <p className="p-4 text-sm text-muted">No hay campañas para el período.</p>}{!state.loading && filteredCampaigns.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-xs uppercase text-muted"><th className="px-4 py-3 text-left">Campaña</th><th>Estado</th><th>Tipo</th><th className="text-right">Gasto</th><th className="text-right">Impresiones</th><th className="text-right">Clics</th><th className="text-right">CTR</th><th className="text-right">Conversiones</th><th className="px-4 text-right">CPP</th></tr></thead><tbody>{filteredCampaigns.map((campaign) => <tr key={campaign.id} className="border-b"><td className="px-4 py-3 font-medium">{campaign.name}</td><td className="text-center">{campaign.status}</td><td className="text-center">{campaign.type}</td><td className="text-right">{fmtMoney(campaign.insights.spend, state.currency)}</td><td className="text-right">{fmtNumber(campaign.insights.impressions)}</td><td className="text-right">{fmtNumber(campaign.insights.clicks)}</td><td className="text-right">{fmtNumber(campaign.insights.ctr, 2)}%</td><td className="text-right">{fmtNumber(campaign.insights.conversions, 2)}</td><td className="px-4 text-right">{campaign.insights.conversions > 0 ? fmtMoney(campaign.insights.cpp, state.currency) : '—'}</td></tr>)}</tbody></table></div>}</CardContent></Card>
    </div>
  )
}

export default function MarketingUnified() {
  const [provider, setProvider] = useState<Provider>('meta')
  return (
    <div className="space-y-5">
      <div className="flex w-fit gap-1 rounded-xl border border-border bg-card p-1">
        <button type="button" onClick={() => setProvider('meta')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${provider === 'meta' ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'}`}>Meta Ads</button>
        <button type="button" onClick={() => setProvider('google')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${provider === 'google' ? 'bg-primary/15 text-foreground' : 'text-muted hover:text-foreground'}`}>Google Ads</button>
      </div>
      {provider === 'meta' ? <MetaAdsPanel /> : <GoogleAdsPanel />}
    </div>
  )
}
