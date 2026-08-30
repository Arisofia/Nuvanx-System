import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'wouter'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MessageCircle,
  RefreshCcw,
  Search,
  Target,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { useLeads } from '../../hooks/useLeads'
import { invokeApi } from '../../lib/invokeApi'
import { pipelineStageLabel } from '../../lib/pipeline'
import type { DoctoraliaAppointment } from '../../types'

type MetaInsightsResponse = {
  success?: boolean
  message?: string
  summary?: {
    spend?: number
    clicks?: number
    conversions?: number
    messagingConversationStarted?: number
  }
}

type GoogleCampaign = {
  id?: string
  name?: string | null
  status?: string | null
  spend?: number
  clicks?: number
  conversions?: number
}

type GoogleHealthResponse = {
  success?: boolean
  verified_at?: string | null
  customer?: {
    id?: string | null
    descriptive_name?: string | null
    currency_code?: string | null
  } | null
  campaigns?: GoogleCampaign[]
}

type AgendaResponse = {
  success?: boolean
  message?: string
  appointments?: DoctoraliaAppointment[]
}

type ProviderStatus = 'live' | 'stale' | 'unavailable'

type ProviderEnvelope<T> = {
  success?: boolean
  provider?: string
  status?: ProviderStatus
  source?: 'provider' | 'cache'
  fetched_at?: string | null
  last_success_at?: string | null
  age_seconds?: number | null
  breaker_state?: string | null
  breaker_open_until?: string | null
  failure_count?: number
  data?: T | null
  error?: string | null
}

type HealthStatus = 'loading' | 'live' | 'stale' | 'error'

type SourceHealth = {
  status: HealthStatus
  lastSuccessAt: string | null
  message: string | null
}

type ProviderState = {
  meta: MetaInsightsResponse | null
  google: GoogleHealthResponse | null
  appointments: DoctoraliaAppointment[]
  health: {
    meta: SourceHealth
    google: SourceHealth
    agenda: SourceHealth
  }
  period: { from: string; to: string }
  loading: boolean
  error: string | null
  refreshedAt: string | null
}

const emptyHealth: SourceHealth = { status: 'loading', lastSuccessAt: null, message: null }

const initialProviderState: ProviderState = {
  meta: null,
  google: null,
  appointments: [],
  health: {
    meta: { ...emptyHealth },
    google: { ...emptyHealth },
    agenda: { ...emptyHealth },
  },
  period: { from: '', to: '' },
  loading: true,
  error: null,
  refreshedAt: null,
}

function localDate(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function monthStart(date = new Date()) {
  return localDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function compactNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString('es-ES')
}

function providerFailure(label: string, message?: string | null) {
  return message ? `${label}: ${message}` : label
}

function lastSuccessLabel(health: SourceHealth) {
  if (!health.lastSuccessAt) return null
  const parsed = new Date(health.lastSuccessAt)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function envelopeUsable<T>(value: ProviderEnvelope<T> | null | undefined): value is ProviderEnvelope<T> & { data: T } {
  return Boolean(
    value
    && value.data
    && value.success !== false
    && (value.status === 'live' || value.status === 'stale'),
  )
}

function resolveEnvelopeHealth<T>(
  envelope: ProviderEnvelope<T> | null,
  hasPrevious: boolean,
  previous: SourceHealth,
): SourceHealth {
  if (envelopeUsable(envelope)) {
    return {
      status: envelope.status === 'stale' ? 'stale' : 'live',
      lastSuccessAt: envelope.last_success_at || previous.lastSuccessAt || envelope.fetched_at || null,
      message: envelope.error || null,
    }
  }
  return {
    status: hasPrevious ? 'stale' : 'error',
    lastSuccessAt: previous.lastSuccessAt,
    message: envelope?.error || 'Proveedor no disponible',
  }
}

function aggregateGoogleCampaigns(google: GoogleHealthResponse | null) {
  const campaigns = Array.isArray(google?.campaigns) ? google.campaigns : []
  return campaigns.reduce(
    (summary, campaign) => ({
      spend: summary.spend + Number(campaign.spend || 0),
      clicks: summary.clicks + Number(campaign.clicks || 0),
      conversions: summary.conversions + Number(campaign.conversions || 0),
    }),
    { spend: 0, clicks: 0, conversions: 0 },
  )
}

function OperationsMetric({
  title,
  value,
  detail,
  icon,
}: Readonly<{ title: string; value: string; detail: string; icon: React.ReactNode }>) {
  return (
    <Card className="overflow-hidden border-border/80 bg-card/95">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted">{detail}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-2.5 text-primary">{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function ProviderPill({ status, children }: Readonly<{ status: HealthStatus; children: React.ReactNode }>) {
  const classes = status === 'live'
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'
    : status === 'stale'
      ? 'border-amber-500/25 bg-amber-500/10 text-amber-700'
      : status === 'loading'
        ? 'border-slate-400/25 bg-slate-400/10 text-slate-500'
        : 'border-rose-500/25 bg-rose-500/10 text-rose-600'
  const dot = status === 'live'
    ? 'bg-emerald-500'
    : status === 'stale'
      ? 'bg-amber-500'
      : status === 'loading'
        ? 'bg-slate-400'
        : 'bg-rose-500'

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  )
}

export function OperationsOverview() {
  const { leads, loading: leadsLoading, error: leadsError } = useLeads()
  const [state, setState] = useState<ProviderState>(initialProviderState)

  const load = useCallback(async () => {
    const now = new Date()
    const currentToday = localDate(now)
    const currentFrom = monthStart(now)
    setState((prev) => ({ ...prev, loading: true, error: null, period: { from: currentFrom, to: currentToday } }))
    const range = new URLSearchParams({ from: currentFrom, to: currentToday }).toString()

    const [agendaResult, metaResult, googleResult] = await Promise.allSettled([
      invokeApi<ProviderEnvelope<AgendaResponse>>(`/control-centre-provider?provider=agenda&date=${encodeURIComponent(currentToday)}`, { timeoutMs: 18_000 }),
      invokeApi<ProviderEnvelope<MetaInsightsResponse>>(`/control-centre-provider?provider=meta&${range}`, { timeoutMs: 18_000 }),
      invokeApi<ProviderEnvelope<GoogleHealthResponse>>(`/control-centre-provider?provider=google&${range}`, { timeoutMs: 18_000 }),
    ])

    const refreshedAt = new Date().toISOString()

    setState((prev) => {
      const agendaEnvelope = agendaResult.status === 'fulfilled' ? agendaResult.value : null
      const metaEnvelope = metaResult.status === 'fulfilled' ? metaResult.value : null
      const googleEnvelope = googleResult.status === 'fulfilled' ? googleResult.value : null

      const agendaUsable = envelopeUsable(agendaEnvelope) && Array.isArray(agendaEnvelope.data.appointments)
      const metaUsable = envelopeUsable(metaEnvelope)
      const googleUsable = envelopeUsable(googleEnvelope) && Array.isArray(googleEnvelope.data.campaigns)

      const appointments = agendaUsable ? agendaEnvelope.data.appointments || [] : prev.appointments
      const meta = metaUsable ? metaEnvelope.data : prev.meta
      const google = googleUsable ? googleEnvelope.data : prev.google

      const agendaHealth = resolveEnvelopeHealth(agendaEnvelope, prev.appointments.length > 0, prev.health.agenda)
      const metaHealth = resolveEnvelopeHealth(metaEnvelope, Boolean(prev.meta), prev.health.meta)
      const googleHealth = resolveEnvelopeHealth(googleEnvelope, Boolean(prev.google), prev.health.google)

      const failures = [
        agendaHealth.status === 'error' ? providerFailure('Agenda', agendaHealth.message) : null,
        metaHealth.status === 'error' ? providerFailure('Meta', metaHealth.message) : null,
        googleHealth.status === 'error' ? providerFailure('Google Ads', googleHealth.message) : null,
      ].filter((value): value is string => Boolean(value))

      return {
        appointments,
        meta,
        google,
        health: {
          meta: metaHealth,
          google: googleHealth,
          agenda: agendaHealth,
        },
        period: { from: currentFrom, to: currentToday },
        loading: false,
        error: failures.length ? `No se pudieron actualizar correctamente: ${failures.join(' · ')}.` : null,
        refreshedAt,
      }
    })
  }, [])

  useEffect(() => {
    const initialRefresh = globalThis.setTimeout(() => void load(), 0)
    const refreshTimer = globalThis.setInterval(() => void load(), 300_000)
    return () => {
      globalThis.clearTimeout(initialRefresh)
      globalThis.clearInterval(refreshTimer)
    }
  }, [load])

  const activeLeads = useMemo(
    () => leads.filter((lead) => !['lost', 'client_completed'].includes(String(lead.status || '').toLowerCase())),
    [leads],
  )

  const newestLeads = useMemo(
    () => [...activeLeads]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 5),
    [activeLeads],
  )

  const todaysAppointments = useMemo(
    () => [...state.appointments]
      .sort((a, b) => String(a.hora || '99:99').localeCompare(String(b.hora || '99:99')))
      .slice(0, 6),
    [state.appointments],
  )

  const confirmed = state.appointments.filter((appointment) => appointment.confirmada).length
  const metaAvailable = Boolean(state.meta && ['live', 'stale'].includes(state.health.meta.status))
  const googleAvailable = Boolean(state.google && ['live', 'stale'].includes(state.health.google.status))
  const metaSpend = metaAvailable ? state.meta?.summary?.spend ?? 0 : 0
  const metaConversions = metaAvailable ? state.meta?.summary?.conversions ?? 0 : 0
  const googleSummary = useMemo(() => aggregateGoogleCampaigns(state.google), [state.google])
  const googleSpend = googleAvailable ? googleSummary.spend : 0
  const googleConversions = googleAvailable ? googleSummary.conversions : 0
  const totalSpend = metaSpend + googleSpend
  const totalConversions = metaConversions + googleConversions
  const acquisitionError = state.error
  const busy = state.loading || leadsLoading
  const metaLastSuccess = lastSuccessLabel(state.health.meta)
  const googleLastSuccess = lastSuccessLabel(state.health.google)
  const crmStatus: HealthStatus = leadsLoading ? 'loading' : leadsError ? 'error' : 'live'

  return (
    <section className="space-y-6" aria-labelledby="operations-overview-title" data-testid="control-centre-overview">
      <div className="rounded-[2rem] border border-border bg-card px-5 py-5 shadow-sm sm:px-7 sm:py-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">NUVANX Control Centre</span>
              <ProviderPill status={state.health.meta.status}>Meta · {state.health.meta.status.toUpperCase()}{state.health.meta.status === 'stale' && metaLastSuccess ? ` · ${metaLastSuccess}` : ''}</ProviderPill>
              <ProviderPill status={state.health.google.status}>Google Ads · {state.health.google.status.toUpperCase()}{state.health.google.status === 'stale' && googleLastSuccess ? ` · ${googleLastSuccess}` : ''}</ProviderPill>
              <ProviderPill status={crmStatus}>CRM interno</ProviderPill>
            </div>
            <h1 id="operations-overview-title" className="mt-4 font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Centro operativo de la clínica</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Leads, agenda, captación y rendimiento en un único lugar. Los datos externos pasan por el gateway autenticado con caché, último dato válido y fallo visible.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted">
              {state.refreshedAt ? `Actualizado ${new Date(state.refreshedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : 'Actualizando datos…'}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={state.loading}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground transition hover:border-primary/40 disabled:opacity-50"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${state.loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>
      </div>

      {(acquisitionError || leadsError) && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-700">
          {[acquisitionError, leadsError].filter(Boolean).join(' ')} Las fuentes con último dato válido se conservan marcadas como STALE; las no disponibles no se presentan como cero confirmado.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OperationsMetric title="Leads por atender" value={busy ? '—' : compactNumber(activeLeads.length)} detail="Registros activos según pipeline canónico" icon={<UsersRound className="h-5 w-5" />} />
        <OperationsMetric title="Agenda de hoy" value={state.loading ? '—' : compactNumber(state.appointments.length)} detail={`${confirmed} confirmadas · ${state.health.agenda.status.toUpperCase()}`} icon={<CalendarDays className="h-5 w-5" />} />
        <OperationsMetric title="Inversión del mes" value={state.loading ? '—' : money(totalSpend)} detail={`Meta ${metaAvailable ? money(metaSpend) : '—'} · Google ${googleAvailable ? money(googleSpend) : '—'}`} icon={<CircleDollarSign className="h-5 w-5" />} />
        <OperationsMetric title="Conversiones Ads" value={state.loading ? '—' : compactNumber(totalConversions)} detail={`Meta ${metaAvailable ? compactNumber(metaConversions) : '—'} · Google ${googleAvailable ? compactNumber(googleConversions) : '—'}`} icon={<Target className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" />Atención inmediata</CardTitle>
              <p className="mt-1 text-xs text-muted">Últimos leads/contactos que requieren seguimiento</p>
            </div>
            <Link href="/crm" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Ver CRM <ArrowRight className="h-3.5 w-3.5" /></Link>
          </CardHeader>
          <CardContent>
            {leadsLoading && <p className="py-8 text-center text-sm text-muted">Cargando leads…</p>}
            {!leadsLoading && newestLeads.length === 0 && <p className="py-8 text-center text-sm text-muted">No hay leads abiertos pendientes.</p>}
            {!leadsLoading && newestLeads.length > 0 && (
              <div className="divide-y divide-border">
                {newestLeads.map((lead) => (
                  <div key={lead.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{lead.name}</p>
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">{pipelineStageLabel(lead.status)}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">{lead.treatment_name || lead.source || 'Origen sin clasificar'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {lead.phone && <span className="inline-flex items-center gap-1 text-[11px] text-muted"><MessageCircle className="h-3.5 w-3.5" />WhatsApp disponible</span>}
                      <Link href="/crm" className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:border-primary/40">Abrir ficha</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />Agenda de hoy</CardTitle>
              <p className="mt-1 text-xs text-muted">Doctoralia sincronizado</p>
            </div>
            <Link href="/live" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Abrir agenda <ArrowRight className="h-3.5 w-3.5" /></Link>
          </CardHeader>
          <CardContent>
            {state.loading && <p className="py-8 text-center text-sm text-muted">Cargando agenda…</p>}
            {!state.loading && todaysAppointments.length === 0 && <p className="py-8 text-center text-sm text-muted">Sin citas registradas para hoy.</p>}
            {!state.loading && todaysAppointments.length > 0 && (
              <div className="space-y-2">
                {todaysAppointments.map((appointment) => (
                  <div key={appointment.raw_hash} className="flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-3 py-2.5">
                    <div className="flex w-12 shrink-0 items-center gap-1 text-xs font-semibold text-foreground"><Clock3 className="h-3.5 w-3.5 text-muted" />{appointment.hora?.slice(0, 5) || '—'}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{appointment.paciente_nombre || 'Paciente sin nombre'}</p>
                      <p className="truncate text-[11px] text-muted">{appointment.asunto || appointment.agenda || 'Cita clínica'}</p>
                    </div>
                    {appointment.confirmada && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Confirmada" />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Adquisición en vivo</CardTitle>
            <p className="mt-1 text-xs text-muted">Gateway NUVANX · Meta Ads y Google Ads · {state.period.from || '—'} → {state.period.to || '—'}</p>
          </div>
          <Link href="/marketing" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Analizar campañas <ArrowRight className="h-3.5 w-3.5" /></Link>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /><p className="text-sm font-semibold">Meta Ads</p></div>
                <ProviderPill status={state.health.meta.status}>{state.health.meta.status.toUpperCase()}{metaLastSuccess ? ` · ${metaLastSuccess}` : ''}</ProviderPill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Inversión</p><p className="mt-1 text-lg font-semibold">{metaAvailable ? money(metaSpend) : '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Clicks</p><p className="mt-1 text-lg font-semibold">{metaAvailable ? compactNumber(state.meta?.summary?.clicks) : '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Conversiones</p><p className="mt-1 text-lg font-semibold">{metaAvailable ? compactNumber(metaConversions) : '—'}</p></div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Search className="h-4 w-4 text-primary" /><p className="text-sm font-semibold">Google Ads</p></div>
                <ProviderPill status={state.health.google.status}>{state.health.google.status.toUpperCase()}{googleLastSuccess ? ` · ${googleLastSuccess}` : ''}</ProviderPill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Inversión</p><p className="mt-1 text-lg font-semibold">{googleAvailable ? money(googleSpend) : '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Clicks</p><p className="mt-1 text-lg font-semibold">{googleAvailable ? compactNumber(googleSummary.clicks) : '—'}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Conversiones</p><p className="mt-1 text-lg font-semibold">{googleAvailable ? compactNumber(googleConversions) : '—'}</p></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
