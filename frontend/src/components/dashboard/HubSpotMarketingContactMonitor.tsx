import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleAlert, Database, RefreshCcw, UsersRound } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Card, CardContent } from '../ui/card'

type MonitorRow = {
  threshold: number
  last_count: number
  above_threshold: boolean
  last_checked_at: string | null
  last_triggered_at: string | null
  updated_at: string | null
}

function formatDateTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function HubSpotMarketingContactMonitor() {
  const [monitor, setMonitor] = useState<MonitorRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('nvx_get_hubspot_marketing_contact_monitor')
      if (rpcError) throw rpcError
      const row = Array.isArray(data) ? data[0] : data
      if (!row) throw new Error('Monitor de HubSpot sin estado disponible')
      setMonitor(row as MonitorRow)
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar el límite de contactos de HubSpot.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = globalThis.setInterval(() => void load(), 300_000)
    return () => globalThis.clearInterval(timer)
  }, [load])

  const status = useMemo(() => {
    if (!monitor) return 'loading' as const
    if (monitor.above_threshold || monitor.last_count >= monitor.threshold) return 'critical' as const
    if (monitor.last_count >= Math.max(0, monitor.threshold - 100)) return 'warning' as const
    return 'normal' as const
  }, [monitor])

  const percent = monitor?.threshold
    ? Math.min(100, Math.round((monitor.last_count / monitor.threshold) * 100))
    : 0
  const remaining = monitor ? Math.max(0, monitor.threshold - monitor.last_count) : 0
  const lastChecked = formatDateTime(monitor?.last_checked_at || monitor?.updated_at || null)

  const statusClasses = status === 'critical'
    ? 'border-rose-500/35 bg-rose-500/8'
    : status === 'warning'
      ? 'border-amber-500/35 bg-amber-500/8'
      : 'border-emerald-500/25 bg-emerald-500/6'
  const statusText = status === 'critical'
    ? 'Umbral alcanzado'
    : status === 'warning'
      ? 'Próximo al umbral'
      : 'Margen disponible'
  const statusTextClass = status === 'critical'
    ? 'text-rose-700'
    : status === 'warning'
      ? 'text-amber-700'
      : 'text-emerald-700'

  return (
    <Card className={`overflow-hidden ${statusClasses}`} data-testid="hubspot-marketing-contact-monitor">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl border border-border/70 bg-card p-2.5 text-primary">
              <UsersRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">HubSpot · Marketing contacts</p>
                {!loading && !error && (
                  <span className={`inline-flex items-center gap-1 rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusTextClass}`}>
                    {status === 'critical' && <CircleAlert className="h-3 w-3" />}
                    {statusText}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                Al llegar a 900 se guarda un snapshot completo en Supabase y se envía la alerta por correo. No cambia el estado de los contactos.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Uso</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                {loading ? '—' : error ? 'Error' : `${monitor?.last_count.toLocaleString('es-ES')} / ${monitor?.threshold.toLocaleString('es-ES')}`}
              </p>
            </div>
            {!loading && !error && monitor && (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Margen</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{remaining.toLocaleString('es-ES')}</p>
                </div>
                <div className="w-36 sm:w-48">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-muted">
                    <span>{percent}%</span>
                    <span>Alerta 900</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border/70">
                    <div className="h-full rounded-full bg-current text-primary transition-all" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-muted">
                    {lastChecked ? `Estado actualizado ${lastChecked}` : 'Primera comprobación diaria pendiente'}
                  </p>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] font-semibold text-foreground transition hover:border-primary/40 disabled:opacity-50"
              aria-label="Actualizar estado de contactos de marketing"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-xs text-rose-700">
            <Database className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
