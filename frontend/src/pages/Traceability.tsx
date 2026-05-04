import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { GitMerge, Search, CheckCircle2, XCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'

interface TraceRow {
  lead_id: string
  lead_name: string | null
  source: string | null
  campaign_name: string | null
  ad_name: string | null
  stage: string | null
  lead_created_at: string | null
  patient_id: string | null
  patient_name: string | null
  patient_dni: string | null
  patient_phone: string | null
  patient_last_visit: string | null
  patient_ltv: number | null
  doc_patient_id: string | null
  match_confidence: number | null
  match_class: string | null
  first_settlement_at: string | null
  doctoralia_net: number | null
  doctoralia_template_name: string | null
  days_to_settlement: number | null
  settlement_date: string | null
}

const MATCH_LABELS: Record<string, string> = {
  exact_phone: 'Teléfono exacto',
  exact_dni: 'DNI exacto',
  exact_name: 'Nombre exacto',
  fuzzy_name: 'Nombre similar',
  partial: 'Parcial',
}

export default function Traceability() {
  const [rows, setRows] = useState<TraceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchedOnly, setMatchedOnly] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: '500' })
    if (matchedOnly) params.set('matched', 'true')
    invokeApi(`/traceability/leads?${params}`)
      .then((data: any) => {
        setRows(data?.leads ?? [])
        setLoading(false)
      })
      .catch((err: any) => {
        setError(err?.message ?? 'Error cargando datos de trazabilidad.')
        setLoading(false)
      })
  }, [matchedOnly])

  const filtered = rows.filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      r.lead_name?.toLowerCase().includes(q) ||
      r.patient_name?.toLowerCase().includes(q) ||
      r.campaign_name?.toLowerCase().includes(q) ||
      r.doc_patient_id?.toLowerCase().includes(q)
    )
  })

  const matchedCount = rows.filter((r) => r.patient_id || r.doc_patient_id).length
  const withRevenueCount = rows.filter((r) => r.doctoralia_net && r.doctoralia_net > 0).length
  const totalRevenue = rows.reduce((s, r) => s + (r.doctoralia_net ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Cruces Doctoralia</h1>
        <p className="text-muted mt-1">Trazabilidad de leads Meta → pacientes Doctoralia → ingresos verificados</p>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted uppercase tracking-wide">Total leads</p>
            <p className="text-2xl font-bold mt-1">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted uppercase tracking-wide">Cruzados con Doctoralia</p>
            <p className="text-2xl font-bold mt-1 text-[#28A745]">{matchedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted uppercase tracking-wide">Con ingresos verificados</p>
            <p className="text-2xl font-bold mt-1 text-primary">{withRevenueCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted uppercase tracking-wide">Ingresos verificados</p>
            <p className="text-2xl font-bold mt-1 text-primary">
              {totalRevenue > 0 ? `€${totalRevenue.toLocaleString('es-ES', { minimumFractionDigits: 0 })}` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-primary" />
            Trazabilidad de leads
          </CardTitle>
          <div className="flex items-center gap-3">
            {/* Matched only toggle */}
            <button
              onClick={() => setMatchedOnly((v) => !v)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                matchedOnly ? 'bg-[#28A745]/20 text-[#28A745]' : 'bg-card text-muted hover:text-foreground border border-border'
              }`}
            >
              Solo cruzados
            </button>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar lead o paciente…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 pr-3 py-1 text-xs bg-surface border border-border rounded w-48 text-foreground placeholder:text-muted focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && (
            <p className="text-sm text-muted py-8 text-center animate-pulse">Cargando trazabilidad…</p>
          )}
          {!loading && error && (
            <p className="text-sm text-[#D9534F] py-8 text-center">{error}</p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="py-12 text-center space-y-2">
              <GitMerge className="h-8 w-8 text-muted mx-auto" />
              <p className="text-sm font-medium text-muted">
                {rows.length === 0
                  ? 'Aún no hay leads registrados.'
                  : 'Ningún resultado para la búsqueda actual.'}
              </p>
              {rows.length === 0 && (
                <p className="text-xs text-muted max-w-sm mx-auto">
                  Los leads de Meta Ads aparecerán aquí automáticamente a medida que lleguen a través del webhook.
                </p>
              )}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="text-left py-2 pr-3 font-medium">Lead</th>
                    <th className="text-left py-2 pr-3 font-medium">Fuente / Campaña</th>
                    <th className="text-left py-2 pr-3 font-medium">Fecha</th>
                    <th className="text-left py-2 pr-3 font-medium">Cruce</th>
                    <th className="text-left py-2 pr-3 font-medium">Paciente Doctoralia</th>
                    <th className="text-right py-2 font-medium">Ingreso €</th>
                    <th className="text-right py-2 font-medium">Días hasta liquidación</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const matched = Boolean(r.patient_id || r.doc_patient_id)
                    const hasRevenue = r.doctoralia_net && r.doctoralia_net > 0
                    return (
                      <tr key={r.lead_id} className="border-b border-border/50 hover:bg-surface/50 transition-colors">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-foreground">{r.lead_name ?? '—'}</p>
                          {r.stage && (
                            <span className="text-muted text-[10px]">{r.stage}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <p className="text-foreground">{r.source ?? '—'}</p>
                          {r.campaign_name && (
                            <p className="text-muted text-[10px] truncate max-w-[160px]">{r.campaign_name}</p>
                          )}
                          {r.ad_name && (
                            <p className="text-muted text-[10px] truncate max-w-[160px]">{r.ad_name}</p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-muted whitespace-nowrap">
                          {r.lead_created_at
                            ? new Date(r.lead_created_at).toLocaleDateString('es-ES')
                            : '—'}
                        </td>
                        <td className="py-2 pr-3">
                          {matched ? (
                            <div className="flex items-center gap-1 text-green-400">
                              <CheckCircle2 className="h-3 w-3 shrink-0" />
                              <span>{r.match_class ? (MATCH_LABELS[r.match_class] ?? r.match_class) : 'Cruzado'}</span>
                              {r.match_confidence != null && (
                                <span className="text-muted">({Math.round(r.match_confidence * 100)}%)</span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-muted">
                              <XCircle className="h-3 w-3 shrink-0" />
                              <span>Sin cruce</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {r.patient_name ? (
                            <p className="text-foreground">{r.patient_name}</p>
                          ) : r.doc_patient_id ? (
                            <p className="text-muted text-[10px]">ID: {r.doc_patient_id}</p>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                          {r.doctoralia_template_name && (
                            <p className="text-muted text-[10px] truncate max-w-[140px]">{r.doctoralia_template_name}</p>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {hasRevenue ? (
                            <span className="text-primary font-medium">
                              €{r.doctoralia_net!.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {r.days_to_settlement != null ? (
                            <span className={r.days_to_settlement <= 30 ? 'text-green-400' : 'text-muted'}>
                              {r.days_to_settlement}d
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
