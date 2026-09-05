import { Activity, AlertCircle, CheckCircle2, Clock3, ExternalLink, Gauge, MapPin, Search } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { type SeoWebPerformanceRow, type SeoWebPerformanceState, useSeoWebPerformance } from '../hooks/useSeoWebPerformance'

const STATUS_COPY: Record<SeoWebPerformanceState, { label: string; className: string }> = {
  loading: { label: 'Verificando', className: 'bg-slate-500/10 text-slate-700' },
  fresh: { label: 'Datos vivos', className: 'bg-emerald-500/10 text-emerald-700' },
  partial: { label: 'Cobertura parcial', className: 'bg-amber-500/10 text-amber-700' },
  stale: { label: 'Stale data', className: 'bg-orange-500/10 text-orange-700' },
  unavailable: { label: 'Indisponible', className: 'bg-red-500/10 text-red-700' },
}

function pathname(url: string) {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function capturedLabel(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'timestamp inválido'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function metric(value: number | null, suffix = '') {
  return value === null ? '—' : `${value}${suffix}`
}

function WebStatusBadge({ state }: { state: SeoWebPerformanceState }) {
  const status = STATUS_COPY[state]
  return <Badge className={`border-0 ${status.className}`}>{status.label}</Badge>
}

function PerformanceCell({ row }: { row: SeoWebPerformanceRow }) {
  const unavailable = row.quality_status === 'unavailable'
  return (
    <div className="rounded-xl border border-[#E5D5C5]/70 bg-[#FCFAF7] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#2C2825]">{pathname(row.url)}</p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7A7068]">{row.device}</p>
        </div>
        <Badge className={`border-0 ${unavailable ? 'bg-red-500/10 text-red-700' : row.quality_status === 'partial' ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-700'}`}>
          {row.quality_status}
        </Badge>
      </div>

      {unavailable ? (
        <div className="mt-4 text-xs leading-relaxed text-red-700">
          <p className="font-semibold">{row.error_code || 'provider_unavailable'}</p>
          {row.error_message ? <p className="mt-1 text-red-700/80">{row.error_message}</p> : null}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><p className="text-[#7A7068]">Performance</p><p className="mt-1 font-semibold text-[#2C2825]">{metric(row.performance_score, '/100')}</p></div>
          <div><p className="text-[#7A7068]">LCP</p><p className="mt-1 font-semibold text-[#2C2825]">{metric(row.lcp_ms, ' ms')}</p></div>
          <div><p className="text-[#7A7068]">CLS</p><p className="mt-1 font-semibold text-[#2C2825]">{metric(row.cls)}</p></div>
          <div><p className="text-[#7A7068]">INP</p><p className="mt-1 font-semibold text-[#2C2825]">{metric(row.inp_ms, ' ms')}</p></div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-1.5 text-[10px] text-[#7A7068]">
        <Clock3 className="h-3 w-3" />
        {capturedLabel(row.captured_at)} · {row.source}
      </div>
    </div>
  )
}

export default function SEOTracker() {
  const web = useSeoWebPerformance()
  const headerHasRuntime = web.state === 'fresh' || web.state === 'partial' || web.state === 'stale'

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Badge className={`border-0 ${headerHasRuntime ? 'bg-amber-500/10 text-amber-700' : 'bg-red-500/10 text-red-700'}`}>
              {headerHasRuntime ? <Activity className="mr-1 h-3 w-3" /> : <AlertCircle className="mr-1 h-3 w-3" />}
              {headerHasRuntime ? 'Telemetría parcial' : 'Telemetría pendiente'}
            </Badge>
          </div>
          <h1 className="text-3xl font-serif font-bold text-[#2C2825]">SEO, Local & Citabilidad IA</h1>
          <p className="mt-2 max-w-3xl text-sm text-[#5C5550]">
            El panel sólo publica métricas respaldadas por una fuente viva, timestamp y estado de calidad verificables.
            Search Console y SEO local permanecen cerrados hasta disponer de ingesta autenticada.
          </p>
        </div>
        <a
          href="https://pagespeed.web.dev/?url=https://nuvanx.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-[#E5D5C5] bg-white px-4 py-2 text-sm font-semibold text-[#84643B]"
        >
          PageSpeed público
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <Card className="border border-[#E5D5C5]/60 bg-white shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-[#2C2825]">
            <Activity className="h-5 w-5 text-[#84643B]" />
            Contrato de datos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-[#5C5550]">
            Cada KPI incluye fuente, timestamp, ámbito y estado de calidad. Más de 48 horas sin una captura utilizable se clasifica como stale;
            una respuesta incompleta o un fallo del proveedor se muestra como parcial o indisponible. Nunca se sustituye por un número estimado o heredado.
          </p>
        </CardContent>
      </Card>

      <Card className="border border-[#E5D5C5]/60 bg-white shadow-none">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base text-[#2C2825]">
              <Gauge className="h-4 w-4 text-[#84643B]" />
              Rendimiento web · PageSpeed / Lighthouse
            </CardTitle>
            <WebStatusBadge state={web.state} />
          </div>
        </CardHeader>
        <CardContent>
          {web.loading ? <p className="text-sm text-[#5C5550]">Consultando snapshots canónicos…</p> : null}
          {web.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">La fuente runtime no pudo consultarse.</p>
              <p className="mt-1 text-xs">{web.error}</p>
            </div>
          ) : null}
          {!web.loading && !web.error && web.rows.length === 0 ? (
            <p className="text-sm text-[#5C5550]">Todavía no existe un snapshot persistido. El panel permanece fail-closed.</p>
          ) : null}
          {web.rows.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {web.rows.map((row) => <PerformanceCell key={`${row.url}-${row.device}`} row={row} />)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="border border-[#E5D5C5]/60 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-[#2C2825]">
              <Search className="h-4 w-4 text-[#84643B]" />
              Search Console
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#5C5550]">Consultas, páginas, impresiones, clics y posición requieren una fuente GSC autenticada y persistida.</p>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Sin fuente runtime conectada</p>
          </CardContent>
        </Card>

        <Card className="border border-[#E5D5C5]/60 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-[#2C2825]">
              <MapPin className="h-4 w-4 text-[#84643B]" />
              SEO local
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#5C5550]">Google Business Profile y reseñas requieren sincronización autenticada por sede.</p>
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Sin fuente runtime conectada</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[#E5D5C5]/60 bg-[#FCFAF7] p-4 text-xs leading-relaxed text-[#5C5550]">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#84643B]" />
        La matriz de rendimiento usa las seis rutas críticas del gate de Lighthouse y ambos dispositivos. INP sólo se publica cuando Google expone field data para URL u origen; de lo contrario queda vacío y el snapshot se marca como parcial.
      </div>
    </div>
  )
}
