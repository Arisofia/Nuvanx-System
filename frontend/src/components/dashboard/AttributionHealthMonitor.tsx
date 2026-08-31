import { useCallback, useEffect, useMemo, useState } from 'react'
import { Fingerprint, RefreshCcw, Route, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Card, CardContent } from '../ui/card'

type AttributionHealth = {
  contract: 'attribution_identity_v1'
  leads: {
    active: number
    websiteHubspot: number
    withGclid: number
    withFbc: number
    withFbp: number
    withUtmSource: number
    gclidCoveragePct: number
    fbcCoveragePct: number
    fbpCoveragePct: number
    utmCoveragePct: number
  }
  webCaptures: {
    total: number
    reconciled: number
    pending: number
    qa: number
    lastCaptureAt: string | null
  }
  googleAttribution: {
    total: number
    reconciled: number
    pending: number
    qa: number
    lastAttributionAt: string | null
  }
  generatedAt: string
}

function isHealth(value: unknown): value is AttributionHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return row.contract === 'attribution_identity_v1'
    && Boolean(row.leads && typeof row.leads === 'object')
    && Boolean(row.webCaptures && typeof row.webCaptures === 'object')
    && Boolean(row.googleAttribution && typeof row.googleAttribution === 'object')
}

function formatDate(value: string | null) {
  if (!value) return 'sin captura real'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'fecha no válida' : date.toLocaleString('es-ES')
}

export function AttributionHealthMonitor() {
  const [health, setHealth] = useState<AttributionHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('nvx_get_attribution_health')
    if (rpcError) {
      setError(rpcError.message)
      setLoading(false)
      return
    }
    if (!isHealth(data)) {
      setError('Contrato de attribution health no válido')
      setLoading(false)
      return
    }
    setHealth(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Schedule the initial fetch through the timer callback instead of synchronously
    // mutating state in the effect body. Subsequent refreshes use the same owner.
    const initial = globalThis.setTimeout(() => void load(), 0)
    const timer = globalThis.setInterval(() => void load(), 300_000)
    return () => {
      globalThis.clearTimeout(initial)
      globalThis.clearInterval(timer)
    }
  }, [load])

  const state = useMemo(() => {
    if (!health) return 'unknown'
    if (health.webCaptures.pending > 0 || health.googleAttribution.pending > 0) return 'attention'
    if (health.webCaptures.total === 0) return 'waiting'
    return 'healthy'
  }, [health])

  const border = state === 'attention'
    ? 'border-amber-500/35 bg-amber-500/7'
    : state === 'healthy'
      ? 'border-emerald-500/25 bg-emerald-500/6'
      : 'border-border bg-card'

  return (
    <Card className={border} data-testid="attribution-health-monitor">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-border/70 bg-card p-2.5 text-primary"><Fingerprint className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-semibold text-foreground">Attribution Identity · adquisición real</p>
                <p className="mt-1 text-xs text-muted">GCLID, FBC, FBP y UTM solo desde evidencia consentida. El ledger QA antiguo ya no forma parte de producción.</p>
              </div>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-[11px] font-semibold text-foreground disabled:opacity-50">
              <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </button>
          </div>

          {error ? (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-xs text-rose-700">{error}</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <Metric label="Leads activos" value={health?.leads.active ?? null} detail={`${health?.leads.websiteHubspot ?? 0} web canónicos`} />
              <Metric label="GCLID" value={health?.leads.withGclid ?? null} detail={`${health?.leads.gclidCoveragePct ?? 0}% cobertura`} />
              <Metric label="FBC" value={health?.leads.withFbc ?? null} detail={`${health?.leads.fbcCoveragePct ?? 0}% cobertura`} />
              <Metric label="FBP" value={health?.leads.withFbp ?? null} detail={`${health?.leads.fbpCoveragePct ?? 0}% cobertura`} />
              <Metric label="UTM source" value={health?.leads.withUtmSource ?? null} detail={`${health?.leads.utmCoveragePct ?? 0}% cobertura`} />
              <Metric label="Web captures" value={health?.webCaptures.total ?? null} detail={`${health?.webCaptures.reconciled ?? 0} reconciliados · ${health?.webCaptures.pending ?? 0} pendientes`} />
            </div>
          )}

          {!error && health && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/70 pt-3 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5"><Route className="h-3.5 w-3.5" /> Última captura web: {formatDate(health.webCaptures.lastCaptureAt)}</span>
              <span>Google ledger: {health.googleAttribution.total} total · {health.googleAttribution.pending} pendientes · {health.googleAttribution.qa} QA</span>
              <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Contrato {health.contract}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value, detail }: Readonly<{ label: string; value: number | null; detail: string }>) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/80 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-foreground">{value == null ? '—' : value.toLocaleString('es-ES')}</p>
      <p className="mt-1 text-[10px] text-muted">{detail}</p>
    </div>
  )
}
