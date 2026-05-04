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
        <h1 className="text-3xl font-bold">Panel en vivo</h1>
        <p className="text-muted mt-1">Flujo de leads en tiempo real y actividad de campañas</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle>Actividad en vivo</CardTitle>
          <Activity className={`h-4 w-4 ${connected ? 'text-green-500 animate-pulse' : 'text-muted'}`} />
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted py-4 text-center">
              {connected ? 'Esperando nuevos eventos...' : 'Conectando con Supabase Realtime...'}
            </p>
          ) : (
            <div className="space-y-3 max-h-[480px] overflow-y-auto">
              {events.map((ev) => (
                <div key={ev.id + ev.ts} className="p-3 bg-surface rounded-lg border border-border">
                  <p className="text-sm font-medium">{ev.label}</p>
                  {ev.detail && <p className="text-xs text-muted mt-1">{ev.detail} • {new Date(ev.ts).toLocaleTimeString()}</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted mt-4">
            {connected ? 'Conectado — escuchando cambios en la tabla de leads.' : 'Conectando con Supabase Realtime...'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
