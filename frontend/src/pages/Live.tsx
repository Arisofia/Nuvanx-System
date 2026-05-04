import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Activity } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import type { LiveEvent } from '../types'

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

export default function Live() {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Preload recent activity from leads + financial_settlements
  useEffect(() => {
    const load = async () => {
      const results: LiveEvent[] = []

      // Recent leads
      const { data: leads } = await supabase
        .from('leads')
        .select('id, source, stage, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(20)
      if (leads) {
        for (const l of leads) {
          results.push(eventFromPayload('INSERT', l))
        }
      }

      // Recent settlements
      const { data: settlements } = await supabase
        .from('financial_settlements')
        .select('id, template_name, amount_net, settled_at, created_at')
        .order('settled_at', { ascending: false })
        .limit(20)
      if (settlements) {
        for (const s of settlements) {
          const net = s.amount_net ? `€${Number(s.amount_net).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
          results.push({
            id: `settlement-${s.id}`,
            type: 'SETTLEMENT',
            label: 'Liquidación Doctoralia',
            detail: [s.template_name, net].filter(Boolean).join(' · '),
            ts: s.settled_at ?? s.created_at ?? new Date().toISOString(),
          })
        }
      }

      // Sort combined by timestamp desc, keep latest 50
      results.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      setEvents(results.slice(0, 50))
    }
    load()
  }, [])

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
              {connected ? 'Sin actividad reciente. Esperando nuevos eventos…' : 'Conectando con Supabase Realtime…'}
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
            {connected ? 'Conectado — escuchando cambios en tiempo real.' : 'Conectando con Supabase Realtime…'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
