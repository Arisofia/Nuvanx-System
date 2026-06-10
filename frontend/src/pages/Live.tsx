import { useEffect, useRef, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Tag, User, CheckCircle2, XCircle, Clock, Stethoscope, MapPin } from 'lucide-react'
import { supabase, invokeApi } from '../lib/supabaseClient'
import type { LiveEvent, DoctoraliaAppointment } from '../types'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'
import { transformDoctoraliaAppointment, transformLiveEvent } from '../lib/transformers'
import { logger } from '../lib/utils'

function toLocalDateStr(date: Date): string {
  return date.toLocaleDateString('sv-SE')
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

const sortByHora = (a: DoctoraliaAppointment, b: DoctoraliaAppointment) =>
  (a.hora || '00:00').localeCompare(b.hora || '00:00')

function CampaignBadge({ name }: { readonly name: string | null }) {
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

function EstadoBadge({ estado, confirmada }: { readonly estado: string | null; readonly confirmada: boolean }) {
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

export default function Live() {
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateStr(new Date()))
  const [appointments, setAppointments] = useState<DoctoraliaAppointment[]>([])
  const [agendaLoading, setAgendaLoading] = useState(false)
  const [agendaError, setAgendaError] = useState<string | null>(null)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      setAgendaLoading(true)
      setAgendaError(null)
      try {
        const data = await invokeApi<{ appointments?: DoctoraliaAppointment[] }>(`/api/agenda/doctoralia?date=${selectedDate}`)
        if (!active) return
        setAppointments(data.appointments ?? [])
      } catch (err: any) {
        if (!active) return
        logger.error('Live.Agenda', err)
        const msg = err?.status === 401 ? 'Sesión expirada.' : (err?.message || 'Error cargando agenda.')
        setAgendaError(msg)
      } finally {
        if (active) setAgendaLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [selectedDate])

  const groupedByHour = useMemo(() => {
    const map = new Map<string, DoctoraliaAppointment[]>()
    const sorted = [...appointments].sort(sortByHora)
    for (const row of sorted) {
      const key = row.hora ? row.hora.slice(0, 5) : 'Sin hora'
      let group = map.get(key)
      if (!group) {
        group = []
        map.set(key, group)
      }
      group.push(row)
    }
    return map
  }, [appointments])

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data: rawRows } = await supabase
        .from('doctoralia_raw')
        .select('raw_hash, paciente_nombre, patient_name, estado, agenda, importe_numerico, timestamp_cita, fecha')
        .order('timestamp_cita', { ascending: false })
        .limit(30)
      if (!active) return
      if (rawRows) setEvents(rawRows.map(r => transformLiveEvent('DOCTORALIA', r)))
    }
    load()
    return () => { active = false }
  }, [])

  const selectedDateRef = useRef(selectedDate)
  useEffect(() => { selectedDateRef.current = selectedDate }, [selectedDate])

  useEffect(() => {
    const channel = supabase
      .channel('live-doctoralia-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doctoralia_raw' }, (payload) => {
        const r = payload.new as any
        const ev = transformLiveEvent('DOCTORALIA', r)
        setEvents((prev) => [ev, ...prev].slice(0, 50))
        const apptDay = (r.fecha ?? '').slice(0, 10)
        if (apptDay === selectedDateRef.current) {
          const newAppt = transformDoctoraliaAppointment(r)
          setAppointments((prev) => [newAppt, ...prev].sort(sortByHora))
        }
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))

    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [])

  const shiftDay = (delta: number) => {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    setSelectedDate(toLocalDateStr(d))
  }
  const isToday = selectedDate === toLocalDateStr(new Date())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Panel en vivo</h1>
        <p className="text-muted mt-1">Agenda Doctoralia del día y flujo en tiempo real</p>
        <MetaAccountsInline context="Las citas con campaña Meta se auditan contra estas cuentas." className="mt-4 max-w-2xl" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" />Agenda Doctoralia</CardTitle>
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDay(-1)} className="p-1.5 rounded hover:bg-surface border border-border text-muted hover:text-foreground transition-colors" aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></button>
            <input type="date" value={selectedDate} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="text-xs bg-surface border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary" />
            <button onClick={() => shiftDay(1)} className="p-1.5 rounded hover:bg-surface border border-border text-muted hover:text-foreground transition-colors" aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></button>
            {!isToday && <button onClick={() => setSelectedDate(toLocalDateStr(new Date()))} className="px-2 py-1 text-xs rounded border border-primary text-primary hover:bg-primary/10 transition-colors">Hoy</button>}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted mb-4 capitalize">{formatDayLabel(selectedDate)}</p>
          {agendaLoading && <p className="text-sm text-muted py-8 text-center animate-pulse">Cargando agenda…</p>}
          {!agendaLoading && agendaError && <p className="text-sm text-[#D9534F] py-8 text-center">{agendaError}</p>}
          {!agendaLoading && !agendaError && appointments.length === 0 && <div className="py-10 text-center space-y-1"><CalendarDays className="h-8 w-8 text-muted mx-auto" /><p className="text-sm text-muted">Sin citas registradas en Doctoralia para este día.</p></div>}
          {!agendaLoading && !agendaError && appointments.length > 0 && (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-4 mb-4 text-xs text-muted">
                <span><span className="font-semibold text-foreground">{appointments.length}</span> citas</span>
                <span><span className="font-semibold text-green-400">{appointments.filter((r) => r.confirmada).length}</span> confirmadas</span>
                <span><span className="font-semibold text-primary">{appointments.filter((r) => r.campaign_name).length}</span> con campaña Meta</span>
              </div>
              {Array.from(groupedByHour.entries()).map(([hour, rows]) => (
                <div key={hour} className="flex gap-3">
                  <div className="w-14 shrink-0 pt-2.5"><span className="text-[10px] font-mono text-muted flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{hour}</span></div>
                  <div className="flex-1 space-y-1.5 border-l border-border pl-3 pb-3">
                    {rows.map((row) => (
                      <div key={row.raw_hash} className="p-3 bg-surface rounded-lg border border-border hover:border-primary/40 transition-colors">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted" />{row.paciente_nombre ?? 'Paciente sin nombre'}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5"><EstadoBadge estado={row.estado} confirmada={row.confirmada} /><CampaignBadge name={row.campaign_name} /></div>
                          </div>
                          {row.importe != null && <span className="text-xs font-bold text-primary">€{Number(row.importe).toLocaleString('es-ES')}</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                          {row.asunto && <span className="flex items-center gap-1"><Stethoscope className="h-3 w-3" />{row.asunto}</span>}
                          {row.agenda && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{row.agenda}</span>}
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

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Flujo en tiempo real {connected ? '●' : '○'}</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {events.map((event) => <div key={event.id} className="rounded-lg border border-border bg-surface p-3"><p className="text-sm font-medium">{event.label}</p><p className="text-xs text-muted mt-1">{event.detail}</p><p className="text-[10px] text-muted mt-1">{new Date(event.ts).toLocaleString('es-ES')}</p></div>)}
            {events.length === 0 && <p className="text-sm text-muted text-center py-8">Sin eventos recientes.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
