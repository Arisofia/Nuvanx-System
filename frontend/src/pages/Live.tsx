import { useEffect, useRef, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Tag, User, CheckCircle2, XCircle } from 'lucide-react'
import { supabase, invokeApi } from '../lib/supabaseClient'
import type { LiveEvent } from '../types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgendaRow {
  lead_id: string
  lead_name: string | null
  source: string | null
  stage: string | null
  campaign_name: string | null
  lead_created_at: string
  patient_id: string | null
  patient_name: string | null
  doc_patient_id: string | null
  match_class: string | null
  match_confidence: number | null
  doctoralia_template_name: string | null
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

// ── Match badge ────────────────────────────────────────────────────────────────

const MATCH_LABELS: Record<string, string> = {
  exact_phone: 'Tel. exacto',
  exact_dni: 'DNI exacto',
  exact_name: 'Nombre exacto',
  fuzzy_name: 'Nombre similar',
  partial: 'Parcial',
}

function MatchBadge({ row }: { row: AgendaRow }) {
  const matched = Boolean(row.patient_id || row.doc_patient_id)
  if (matched) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-400 border border-green-500/25">
        <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
        {row.match_class ? (MATCH_LABELS[row.match_class] ?? 'Cruzado') : 'Cruzado'}
        {row.match_confidence != null && (
          <span className="opacity-70">({Math.round(row.match_confidence * 100)}%)</span>
        )}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-border/40 text-muted border border-border">
      <XCircle className="h-2.5 w-2.5 shrink-0" />
      Sin cruce Doc.
    </span>
  )
}

// ── Live feed helpers ─────────────────────────────────────────────────────────

function eventFromPayload(eventType: string, record: any): LiveEvent {
  const ts = record.created_at ?? record.updated_at ?? new Date().toISOString()
  const source = record.source ?? ''
  const stage = record.stage ?? ''

  let label = 'Nuevo lead recibido'
  let detail = ''

  if (eventType === 'INSERT') {
    detail = source ? `Fuente: ${source}` : 'Entrada en el pipeline'
  } else if (eventType === 'UPDATE') {
    label = 'Lead actualizado'
    detail = stage ? `Etapa: ${stage}` : 'Registro actualizado'
  } else if (eventType === 'SETTLEMENT') {
    label = 'Liquidación Doctoralia'
    detail = source
  }

  return {
    id: String(record.id ?? Math.random()),
    type: eventType,
    label,
    detail,
    ts,
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Live() {
  // ── Agenda state ───────────────────────────────────────────────────────────
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateStr(new Date()))
  const [agendaRows, setAgendaRows] = useState<AgendaRow[]>([])
  const [agendaLoading, setAgendaLoading] = useState(false)
  const [agendaError, setAgendaError] = useState<string | null>(null)

  // ── Live feed state ────────────────────────────────────────────────────────
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // ── Agenda: load when date changes ────────────────────────────────────────
  useEffect(() => {
    let active = true
    const load = async () => {
      setAgendaLoading(true)
      setAgendaError(null)
      try {
        const params = new URLSearchParams({ from: selectedDate, to: selectedDate, limit: '200' })
        const data = await invokeApi(`/traceability/leads?${params}`)
        if (!active) return
        setAgendaRows(data?.leads ?? [])
      } catch (err: any) {
        if (!active) return
        setAgendaError(err?.message ?? 'Error cargando agenda.')
      } finally {
        if (active) setAgendaLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [selectedDate])

  // ── Agenda: group by hour ─────────────────────────────────────────────────
  const groupedByHour = useMemo(() => {
    const map = new Map<string, AgendaRow[]>()
    const sorted = [...agendaRows].sort(
      (a, b) => new Date(a.lead_created_at).getTime() - new Date(b.lead_created_at).getTime()
    )
    for (const row of sorted) {
      const hour = new Date(row.lead_created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      if (!map.has(hour)) map.set(hour, [])
      map.get(hour)!.push(row)
    }
    return map
  }, [agendaRows])

  // ── Live feed: preload ─────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const results: LiveEvent[] = []
      const { data: leads } = await supabase
        .from('leads')
        .select('id, source, stage, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(20)
      if (leads) {
        for (const l of leads) results.push(eventFromPayload('INSERT', l))
      }
      const { data: settlements } = await supabase
        .from('financial_settlements')
        .select('id, template_name, amount_net, settled_at, created_at')
        .order('settled_at', { ascending: false })
        .limit(20)
      if (settlements) {
        for (const s of settlements) {
          const net = s.amount_net
            ? `€${Number(s.amount_net).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : ''
          results.push({
            id: `settlement-${s.id}`,
            type: 'SETTLEMENT',
            label: 'Liquidación Doctoralia',
            detail: [s.template_name, net].filter(Boolean).join(' · '),
            ts: s.settled_at ?? s.created_at ?? new Date().toISOString(),
          })
        }
      }
      results.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      setEvents(results.slice(0, 50))
    }
    load()
  }, [])

  // ── Live feed: realtime subscription ──────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('live-lead-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        setEvents((prev) => [eventFromPayload('INSERT', payload.new), ...prev].slice(0, 50))
        // Refresh agenda if the new lead falls on the selected day
        const newDay = toLocalDateStr(new Date(payload.new.created_at ?? Date.now()))
        if (newDay === selectedDate) {
          setAgendaRows((prev) => [payload.new as AgendaRow, ...prev])
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        setEvents((prev) => [eventFromPayload('UPDATE', payload.new), ...prev].slice(0, 50))
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [selectedDate])

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
        <p className="text-muted mt-1">Agenda de leads por día y flujo en tiempo real</p>
      </div>

      {/* ── AGENDA ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" />
            Agenda de leads
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
          {!agendaLoading && !agendaError && agendaRows.length === 0 && (
            <div className="py-10 text-center space-y-1">
              <CalendarDays className="h-8 w-8 text-muted mx-auto" />
              <p className="text-sm text-muted">Sin leads registrados para este día.</p>
            </div>
          )}

          {!agendaLoading && !agendaError && agendaRows.length > 0 && (
            <div className="space-y-1">
              {/* Summary counts */}
              <div className="flex gap-4 mb-4 text-xs text-muted">
                <span><span className="font-semibold text-foreground">{agendaRows.length}</span> leads</span>
                <span>
                  <span className="font-semibold text-primary">
                    {agendaRows.filter((r) => r.campaign_name).length}
                  </span> con campaña
                </span>
                <span>
                  <span className="font-semibold text-muted">
                    {agendaRows.filter((r) => !r.campaign_name).length}
                  </span> sin campaña
                </span>
                <span>
                  <span className="font-semibold text-green-400">
                    {agendaRows.filter((r) => r.patient_id || r.doc_patient_id).length}
                  </span> cruzados Doctoralia
                </span>
              </div>

              {/* Timeline grouped by hour */}
              {Array.from(groupedByHour.entries()).map(([hour, rows]) => (
                <div key={hour} className="flex gap-3">
                  {/* Time column */}
                  <div className="w-12 shrink-0 pt-2.5">
                    <span className="text-[10px] font-mono text-muted">{hour}</span>
                  </div>
                  {/* Events column */}
                  <div className="flex-1 space-y-1.5 border-l border-border pl-3 pb-3">
                    {rows.map((row) => (
                      <div
                        key={row.lead_id}
                        className="p-3 bg-surface rounded-lg border border-border hover:border-primary/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          {/* Name + source */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <User className="h-3.5 w-3.5 text-muted shrink-0" />
                            <span className="text-sm font-medium text-foreground truncate">
                              {row.lead_name ?? 'Lead sin nombre'}
                            </span>
                            {row.source && (
                              <span className="text-[10px] text-muted shrink-0">· {row.source}</span>
                            )}
                          </div>
                          {/* Stage */}
                          {row.stage && (
                            <span className="text-[10px] text-muted shrink-0 hidden sm:block">{row.stage}</span>
                          )}
                        </div>
                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <CampaignBadge name={row.campaign_name} />
                          <MatchBadge row={row} />
                          {(row.patient_id || row.doc_patient_id) && row.doctoralia_template_name && (
                            <span className="text-[10px] text-muted truncate max-w-[180px]">
                              {row.doctoralia_template_name}
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
