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

type GoogleStatusResponse = {
  success?: boolean
  connected?: boolean
  status?: string
  message?: string
  customerId?: string | null
  lastSync?: string | null
}

type GoogleInsightsResponse = {
  success?: boolean
  message?: string
  summary?: {
    spend?: number
    clicks?: number
    conversions?: number
  }
}

type AgendaResponse = {
  success?: boolean
  message?: string
  appointments?: DoctoraliaAppointment[]
}

type ProviderState = {
  meta: MetaInsightsResponse | null
  googleStatus: GoogleStatusResponse | null
  google: GoogleInsightsResponse | null
  appointments: DoctoraliaAppointment[]
  period: { from: string; to: string }
  loading: boolean
  error: string | null
  refreshedAt: string | null
}

const initialProviderState: ProviderState = {
  meta: null,
  googleStatus: null,
  google: null,
  appointments: [],
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

function statusLabel(status: string | null | undefined) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'lead') return 'Nuevo lead'
  if (normalized === 'whatsapp') return 'En conversación'
  if (normalized === 'appointment') return 'Con cita'
  if (normalized === 'treatment') return 'En tratamiento'
  if (normalized === 'closed') return 'Cerrado'
  return status || 'Sin estado'
}

function providerFailure(label: string, message?: string) {
  return message ? `${label}: ${message}` : label
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

function ProviderPill({ ok, children }: Readonly<{ ok: boolean; children: React.ReactNode }>) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ok ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/25 bg-amber-500/10 text-amber-600'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
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
    const params = new URLSearchParams({ from: currentFrom, to: currentToday }).toString()

    const [agendaResult, metaResult, googleStatusResult, googleResult] = await Promise.allSettled([
      invokeApi<AgendaResponse>(`/api/agenda/doctoralia?date=${encodeURIComponent(currentToday)}`),
      invokeApi<MetaInsightsResponse>(`/api/meta/insights?${params}`),
      invokeApi<GoogleStatusResponse>('/api/google-ads/status'),
      invokeApi<GoogleInsightsResponse>(`/api/google-ads/insights?${params}`),
    ])

    const failures: string[] = []
    if (agendaResult.status === 'rejected') {
      failures.push('agenda')
    } else if (agendaResult.value.success === false) {
      failures.push(providerFailure('agenda', agendaResult.value.message))
    }

    if (metaResult.status === 'rejected') {
      failures.push('Meta')
    } else if (metaResult.value.success === false) {
      failures.push(providerFailure('Meta', metaResult.value.message))
    }

    if (googleStatusResult.status === 'rejected') {
      failures.push('Google Ads: estado no disponible')
    } else if (googleStatusResult.value.success === false) {
      failures.push(providerFailure('Google Ads', googleStatusResult.value.message || googleStatusResult.value.status))
    }

    if (googleResult.status === 'rejected') {
      failures.push('Google Ads: métricas no disponibles')
    } else if (googleResult.value.success === false) {
      failures.push(providerFailure('Google Ads', googleResult.value.message))
    }

    setState({
      appointments: agendaResult.status === 'fulfilled' && agendaResult.value.success !== false && Array.isArray(agendaResult.value.appointments)
        ? agendaResult.value.appointments
        : [],
      meta: metaResult.status === 'fulfilled' ? metaResult.value : null,
      googleStatus: googleStatusResult.status === 'fulfilled' ? googleStatusResult.value : null,
      google: googleResult.status === 'fulfilled' ? googleResult.value : null,
      period: { from: currentFrom, to: currentToday },
      loading: false,
      error: failures.length ? `No se pudieron actualizar correctamente: ${failures.join(' · ')}.` : null,
      refreshedAt: new Date().toISOString(),
    })
  }, [])

  useEffect(() => {
    void load()
    const refreshTimer = globalThis.setInterval(() => void load(), 300_000)
    return () => globalThis.clearInterval(refreshTimer)
  }, [load])

  const activeLeads = useMemo(
    () => leads.filter((lead) => !['closed', 'treatment'].includes(String(lead.status || '').toLowerCase())),
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
  const metaHealthy = Boolean(state.meta && state.meta.success !== false)
  const googleHealthy = Boolean(state.googleStatus?.connected && state.google?.success !== false)
  const metaSpend = metaHealthy ? state.meta?.summary?.spend ?? 0 : 0
  const metaConversions = metaHealthy ? state.meta?.summary?.conversions ?? 0 : 0
  const googleSpend = googleHealthy ? state.google?.summary?.spend ?? 0 : 0
  const googleConversions = googleHealthy ? state.google?.summary?.conversions ?? 0 : 0
  const totalSpend = metaSpend + googleSpend
  const totalConversions = metaConversions + googleConversions
  const acquisitionError = state.error
  const busy = state.loading || leadsLoading

  return (
    <section className="space-y-6" aria-labelledby="operations-overview-title" data-testid="control-centre-overview">
      <div className="rounded-[2rem] border border-border bg-card px-5 py-5 shadow-sm sm:px-7 sm:py-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">NUVANX Control Centre</span>
              <ProviderPill ok={metaHealthy}>Meta</ProviderPill>
              <ProviderPill ok={googleHealthy}>Google Ads</ProviderPill>
              <ProviderPill ok={!leadsError}>CRM interno</ProviderPill>
            </div>
            <h1 id="operations-overview-title" className="mt-4 font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Centro operativo de la clínica</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Pacientes, agenda, captación y rendimiento en un único lugar. Todos los indicadores de este bloque provienen de las APIs productivas de NUVANX.</p>
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
          {[acquisitionError, leadsError].filter(Boolean).join(' ')} Los módulos disponibles siguen mostrando únicamente datos confirmados.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OperationsMetric title="Pacientes por atender" value={busy ? '—' : compactNumber(activeLeads.length)} detail="Leads activos sin cierre/tratamiento" icon={<UsersRound className="h-5 w-5" />} />
        <OperationsMetric title="Agenda de hoy" value={state.loading ? '—' : compactNumber(state.appointments.length)} detail={`${confirmed} confirmadas`} icon={<CalendarDays className="h-5 w-5" />} />
        <OperationsMetric title="Inversión del mes" value={state.loading ? '—' : money(totalSpend)} detail={`Meta ${money(metaSpend)} · Google ${money(googleSpend)}`} icon={<CircleDollarSign className="h-5 w-5" />} />
        <OperationsMetric title="Conversiones Ads" value={state.loading ? '—' : compactNumber(totalConversions)} detail={`Meta ${compactNumber(metaConversions)} · Google ${compactNumber(googleConversions)}`} icon={<Target className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-border/80">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" />Atención inmediata</CardTitle>
              <p className="mt-1 text-xs text-muted">Últimos pacientes/leads que requieren seguimiento</p>
            </div>
            <Link href="/crm" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Ver pacientes <ArrowRight className="h-3.5 w-3.5" /></Link>
          </CardHeader>
          <CardContent>
            {leadsLoading && <p className="py-8 text-center text-sm text-muted">Cargando pacientes…</p>}
            {!leadsLoading && newestLeads.length === 0 && <p className="py-8 text-center text-sm text-muted">No hay leads abiertos pendientes.</p>}
            {!leadsLoading && newestLeads.length > 0 && (
              <div className="divide-y divide-border">
                {newestLeads.map((lead) => (
                  <div key={lead.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{lead.name}</p>
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">{statusLabel(lead.status)}</span>
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
            <p className="mt-1 text-xs text-muted">Datos directos de Meta Ads y Google Ads · {state.period.from || '—'} → {state.period.to || '—'}</p>
          </div>
          <Link href="/marketing" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Analizar campañas <ArrowRight className="h-3.5 w-3.5" /></Link>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /><p className="text-sm font-semibold">Meta Ads</p></div>
                <ProviderPill ok={metaHealthy}>{metaHealthy ? 'API activa' : 'Revisar conexión'}</ProviderPill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Inversión</p><p className="mt-1 text-lg font-semibold">{money(metaSpend)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Clicks</p><p className="mt-1 text-lg font-semibold">{compactNumber(metaHealthy ? state.meta?.summary?.clicks : 0)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Conversiones</p><p className="mt-1 text-lg font-semibold">{compactNumber(metaConversions)}</p></div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-surface/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Search className="h-4 w-4 text-primary" /><p className="text-sm font-semibold">Google Ads</p></div>
                <ProviderPill ok={googleHealthy}>{googleHealthy ? 'Conectado' : 'Revisar conexión'}</ProviderPill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Inversión</p><p className="mt-1 text-lg font-semibold">{money(googleSpend)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Clicks</p><p className="mt-1 text-lg font-semibold">{compactNumber(googleHealthy ? state.google?.summary?.clicks : 0)}</p></div>
                <div><p className="text-[10px] uppercase tracking-wide text-muted">Conversiones</p><p className="mt-1 text-lg font-semibold">{compactNumber(googleConversions)}</p></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
