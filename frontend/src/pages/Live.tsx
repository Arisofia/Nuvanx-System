import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Activity } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { LiveEvent } from '../types'

function eventFromPayload(eventType: string, record: any): LiveEvent {
  const ts = record.created_at ?? record.updated_at ?? new Date().toISOString()
  const source = record.source ?? ''
  const stage = record.stage ?? ''

  let label = 'Lead activity'
  let detail = ''

  if (eventType === 'INSERT') {
    label = `New lead received`
    detail = source ? `From ${source}` : 'New entry in pipeline'
  } else if (eventType === 'UPDATE') {
    label = `Lead updated`
    detail = stage ? `Stage: ${stage}` : 'Record updated'
  }

  return {
    id: String(record.id ?? Math.random()),
    type: eventType,
    label,
    detail,
    ts,
  }
}

export default function Live() {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const channel = supabase
      .channel('live-lead-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload) => {
        setEvents((prev) => [eventFromPayload('INSERT', payload.new), ...prev].slice(0, 50))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (payload) => {
        setEvents((prev) => [eventFromPayload('UPDATE', payload.new), ...prev].slice(0, 50))
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    channelRef.current = channel

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
<<<<<<< Updated upstream
        <h1 className="text-3xl font-bold">Live Dashboard</h1>
        <p className="text-slate-400 mt-1">Real-time lead flow + activity feed</p>
=======
        <h1 className="text-3xl font-bold">Panel en vivo</h1>
        <p className="text-slate-600 mt-1">Flujo de leads en tiempo real y actividad de campañas</p>
>>>>>>> Stashed changes
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
<<<<<<< Updated upstream
          <CardTitle>Live Activity Feed</CardTitle>
          <Activity className={`h-4 w-4 ${connected ? 'text-green-500 animate-pulse' : 'text-slate-400'}`} />
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">
              {connected ? 'Waiting for new lead events…' : 'Connecting to Supabase Realtime…'}
            </p>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto">
              {events.map((ev) => (
                <div key={ev.id + ev.ts} className="p-3 bg-slate-900 rounded-lg border border-slate-700">
                  <p className="text-sm font-medium">{ev.label}</p>
                  {ev.detail && <p className="text-xs text-slate-400 mt-1">{ev.detail} • {new Date(ev.ts).toLocaleTimeString()}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-4">
            {connected ? 'Connected — listening for changes on leads table.' : 'Connecting to Supabase Realtime…'}
          </p>
=======
          <CardTitle>Actividad en vivo</CardTitle>
          <Activity className="h-4 w-4 text-green-500 animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="p-3 bg-brand-50 rounded-lg border border-brand-200">
              <p className="text-sm font-medium">Nuevo lead recibido</p>
              <p className="text-xs text-slate-500 mt-1">Desde Meta Lead Ads • 2 minutos</p>
            </div>
            <div className="p-3 bg-brand-100 rounded-lg border border-brand-200">
              <p className="text-sm font-medium">Mensaje de WhatsApp enviado</p>
              <p className="text-xs text-slate-500 mt-1">Secuencia de seguimiento iniciada • 5 minutos</p>
            </div>
            <div className="p-3 bg-brand-200 rounded-lg border border-brand-300">
              <p className="text-sm font-medium">Cita programada</p>
              <p className="text-xs text-slate-500 mt-1">Lead moved to stage: Appointment • 12 minutos</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-4">Conectando con Supabase Realtime...</p>
>>>>>>> Stashed changes
        </CardContent>
      </Card>
    </div>
  )
}
