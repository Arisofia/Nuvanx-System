import { useEffect, useRef, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Tag, User, CheckCircle2, XCircle, Clock, Stethoscope, MapPin } from 'lucide-react'
import { supabase, invokeApi } from '../lib/supabaseClient'
import type { LiveEvent } from '../types'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DoctoraliaAppointment {
  raw_hash: string
  paciente_nombre: string | null
  hora: string | null
  estado: string | null
  asunto: string | null
  agenda: string | null
  sala_box: string | null
  procedencia: string | null
  importe: number | null
  confirmada: boolean
  timestamp_cita: string | null
  doc_patient_id: string | null
  // Campaign attribution
  lead_id: string | null
  campaign_name: string | null
  match_class: string | null
  match_confidence: number | null
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toLocalDateStr(date: Date): string {
  return date.toLocaleDateString('sv-SE') // 'YYYY-MM-DD' in local TZ
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Campaign badge ─────────────────────────────────────────────────────────────

function CampaignBadge({ name }: { name: string | null }) {
  if (name) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/15 text-primary border border-primary/25 max-w-[200px] truncate">
        <Tag className="h-2.5 w-2.5 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-border/60 text-muted border border-border">
      <Tag className="h-2.5 w-2.5 shrink-0" />
      Sin campaña
    </span>
  )
}

// ── Estado badge ───────────────────────────────────────────────────────────────

function EstadoBadge({ estado, confirmada }: { estado: string | null; confirmada: boolean }) {
  const e = (estado ?? '').toLowerCase()
  let cls = 'bg-border/40 text-muted border-border'
  let Icon = XCircle
  if (e.includes('confirm') || confirmada) { cls = 'bg-green-500/15 text-green-400 border-green-500/25'; Icon = CheckCircle2 }
  else if (e.includes('asist') || e.includes('showed')) { cls = 'bg-primary/15 text-primary border-primary/25'; Icon = CheckCircle2 }
  else if (e.includes('cancel')) { cls = 'bg-red-500/15 text-red-400 border-red-500/25'; Icon = XCircle }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {estado ?? 'Sin estado'}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Live() {
  // ── Agenda state ───────────────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateStr(new Date()))
  const [appointments, setAppointments] = useState<DoctoraliaAppointment[]>([])
  const [agendaLoading, setAgendaLoading] = useState(false)
  const [agendaError, setAgendaError] = useState<string | null>(null)

  // ── Live feed state ────────────────────────────────────────────────────────
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Agenda: load Doctoralia patients for the selected date ─────────────────
  useEffect(() => {
    let active = true
    const load = async () => {
      setAgendaLoading(true)
      setAgendaError(null)
      try {
        const data = await invokeApi(`/agenda/doctoralia?date=${selectedDate}`)
        if (!active) return
        setAppointments(data?.appointments ?? [])
      } catch (err: any) {
        if (!active) return
        const msg = err?.status === 401 ? 'Sesión expirada.' : (err?.message || 'Error cargando agenda.')
        setAgendaError(msg)
      } finally {
        if (active) setAgendaLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [selectedDate])

  // ── Agenda: group by hour ─────────────────────────────────────────────────
  const groupedByHour = useMemo(() => {
    const map = new Map<string, DoctoraliaAppointment[]>()
    const sorted = [...appointments].sort((a, b) => {
      const ta = a.hora ?? '00:00'
      const tb = b.hora ?? '00:00'
      return ta.localeCompare(tb)
    })
    for (const row of sorted) {
      const key = row.hora ? row.hora.slice(0, 5) : 'Sin hora'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return map
  }, [appointments])

  // ── Live feed: preload recent Doctoralia events ────────────────────────────
  useEffect(() => {
    let active = true
    const load = async () => {
      const results: LiveEvent[] = []
      const { data: rawRows } = await supabase
        .from('doctoralia_raw')
        .select('raw_hash, paciente_nombre, patient_name, estado, agenda, importe_numerico, timestamp_cita, fecha')
        .order('timestamp_cita', { ascending: false })
        .limit(30)
      
      if (!active) return

      if (rawRows) {
        for (const r of rawRows) {
          results.push({
            id: String(r.raw_hash ?? `preload-${Math.random()}`),
            type: 'DOCTORALIA',
            label: r.paciente_nombre ?? r.patient_name ?? 'Paciente Doctoralia',
            detail: [r.agenda, r.estado, r.importe_numerico != null ? `€${Number(r.importe_numerico).toLocaleString('es-ES', { minimumFractionDigits: 0 })}` : ''].filter(Boolean).join(' · '),
            ts: r.timestamp_cita ?? (r.fecha ? r.fecha + 'T09:00:00Z' : new Date().toISOString()),
          })
        }
      }
      results.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      setEvents(results.slice(0, 50))
    }
    load()
    return () => { active = false }
  }, [])

  // ── Live feed: realtime subscription on doctoralia_raw ────────────────────
  const selectedDateRef = useRef(selectedDate)
  useEffect(() => {
    selectedDateRef.current = selectedDate
  }, [selectedDate])

  useEffect(() => {
    const channel = supabase
      .channel('live-doctoralia-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doctoralia_raw' }, (payload) => {
        const r = payload.new as any
        const ev: LiveEvent = {
          id: String(r.raw_hash ?? Math.random()),
          type: 'DOCTORALIA',
          label: r.paciente_nombre ?? r.patient_name ?? 'Nuevo paciente Doctoralia',
          detail: [r.agenda, r.estado].filter(Boolean).join(' · '),
          ts: r.timestamp_cita ?? r.fecha ?? new Date().toISOString(),
        }
        setEvents((prev) => [ev, ...prev].slice(0, 50))
        // Refresh agenda if the appointment is on the selected day
        const apptDay = (r.fecha ?? '').slice(0, 10)
        if (apptDay === selectedDateRef.current) {
          const newAppt: DoctoraliaAppointment = {
            raw_hash: r.raw_hash,
            paciente_nombre: r.paciente_nombre ?? r.patient_name ?? null,
            hora: r.hora_inicio ?? r.hora ?? null,
            estado: r.estado ?? null,
            asunto: r.procedimiento_nombre ?? r.treatment ?? r.asunto ?? null,
            agenda: r.agenda ?? null,
            sala_box: r.sala_box ?? null,
            procedencia: r.procedencia ?? null,
            importe: r.importe_numerico ?? null,
            confirmada: r.confirmada ?? false,
            timestamp_cita: r.timestamp_cita ?? null,
            doc_patient_id: r.doc_patient_id ?? null,
            lead_id: r.lead_id ?? null,
            campaign_name: r.campaign_name ?? null,
            match_class: r.match_class ?? null,
            match_confidence: r.match_confidence ?? null,
          }
          setAppointments((prev) => [newAppt, ...prev].sort((a, b) => (a.hora || '00:00').localeCompare(b.hora || '00:00')))
        }
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Date navigation ────────────────────────────────────────────────────────
  const shiftDay = (delta: number) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(toLocalDateStr(d))
  }
  const isToday = selectedDate === toLocalDateStr(new Date())

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Panel en vivo</h1>
        <p className="text-muted mt-1">Agenda Doctoralia del día y flujo en tiempo real</p>
        <MetaAccountsInline context="Las citas con campaña Meta se auditan contra estas cuentas." className="mt-4 max-w-2xl" />
      </div>

      {/* ── AGENDA ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            Agenda Doctoralia
          </CardTitle>
          {/* Day picker */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => shiftDay(-1)}
              className="p-1.5 rounded hover:bg-surface border border-border text-muted hover:text-foreground transition-colors"
              aria-label="Día anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="text-xs bg-surface border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary"
            />
            <button
              onClick={() => shiftDay(1)}
              className="p-1.5 rounded hover:bg-surface border border-border text-muted hover:text-foreground transition-colors"
              aria-label="Día siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {!isToday && (
              <button
                onClick={() => setSelectedDate(toLocalDateStr(new Date()))}
                className="px-2 py-1 text-xs rounded border border-primary text-primary hover:bg-primary/10 transition-colors"
              >
                Hoy
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted mb-4 capitalize">{formatDayLabel(selectedDate)}</p>

          {agendaLoading && (
            <p className="text-sm text-muted py-8 text-center animate-pulse">Cargando agenda…</p>
          )}
          {!agendaLoading && agendaError && (
            <p className="text-sm text-[#D9534F] py-8 text-center">{agendaError}</p>
          )}
          {!agendaLoading && !agendaError && appointments.length === 0 && (
            <div className="py-10 text-center space-y-1">
              <CalendarDays className="h-8 w-8 text-muted mx-auto" />
              <p className="text-sm text-muted">Sin citas registradas en Doctoralia para este día.</p>
            </div>
          )}

          {!agendaLoading && !agendaError && appointments.length > 0 && (
            <div className="space-y-1">
              {/* Summary counts */}
              <div className="flex flex-wrap gap-4 mb-4 text-xs text-muted">
                <span><span className="font-semibold text-foreground">{appointments.length}</span> pacientes</span>
                <span>
                  <span className="font-semibold text-green-400">
                    {appointments.filter((r) => r.confirmada).length}
                  </span> confirmados
                </span>
                <span>
                  <span className="font-semibold text-primary">
                    {appointments.filter((r) => r.campaign_name).length}
                  </span> con campaña Meta
                </span>
              </div>

              {/* Timeline grouped by hour */}
              {Array.from(groupedByHour.entries()).map(([hour, rows]) => (
                <div key={hour} className="flex gap-3">
                  {/* Time column */}
                  <div className="w-14 shrink-0 pt-2.5">
                    <span className="text-[10px] font-mono text-muted flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />{hour}
                    </span>
                  </div>
                  {/* Events column */}
                  <div className="flex-1 space-y-1.5 border-l border-border pl-3 pb-3">
                    {rows.map((row) => (
                      <div
                        key={row.raw_hash}
                        className="p-3 bg-surface rounded-lg border border-border hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          {/* Patient name */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <User className="h-3.5 w-3.5 text-muted shrink-0" />
                            <span className="text-sm font-medium text-foreground truncate">
                              {row.paciente_nombre ?? 'Paciente sin nombre'}
                            </span>
                          </div>
                          {/* Import */}
                          {row.importe != null && row.importe > 0 && (
                            <span className="text-xs font-semibold text-foreground shrink-0">
                              €{Number(row.importe).toLocaleString('es-ES', { minimumFractionDigits: 0 })}
                            </span>
                          )}
                        </div>
                        {/* Service / treatment */}
                        {row.asunto && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <Stethoscope className="h-3 w-3 text-muted shrink-0" />
                            <span className="text-xs text-muted truncate">{row.asunto}</span>
                          </div>
                        )}
                        {/* Room / agenda */}
                        {(row.sala_box || row.agenda) && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 text-muted shrink-0" />
                            <span className="text-xs text-muted truncate">
                              {[row.agenda, row.sala_box].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        )}
                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <EstadoBadge estado={row.estado} confirmada={row.confirmada} />
                          <CampaignBadge name={row.campaign_name} />
                          {row.procedencia && (
                            <span className="text-[10px] text-muted border border-border rounded-full px-2 py-0.5">
                              {row.procedencia}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── LIVE FEED ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Actividad en vivo</CardTitle>
          <Activity className={`h-4 w-4 ${connected ? 'text-green-500 animate-pulse' : 'text-muted'}`} />
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">
              {connected ? 'Sin actividad reciente. Esperando nuevos eventos…' : 'Conectando con Supabase Realtime…'}
            </p>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto">
              {events.map((ev) => (
                <div key={ev.id + ev.ts} className="p-3 bg-surface rounded-lg border border-border">
                  <p className="text-sm font-medium">{ev.label}</p>
                  {ev.detail && (
                    <p className="text-xs text-muted mt-1">
                      {ev.detail} • {new Date(ev.ts).toLocaleTimeString('es-ES')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted mt-4">
            {connected ? 'Conectado — escuchando cambios en tiempo real.' : 'Conectando con Supabase Realtime…'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
