import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { GitMerge, Search, CheckCircle2, XCircle, TrendingUp, MessageCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import { SortableTable, type ColDef } from '../components/ui/SortableTable'

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
  const [total, setTotal] = useState(0)
  const [matchedTotal, setMatchedTotal] = useState<number | null>(null)
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [funnel, setFunnel] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchedOnly, setMatchedOnly] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let isActive = true

    const loadData = async () => {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ limit: '500' })
        if (matchedOnly) params.set('matched', 'true')
        
        const [leadsData, campaignsData, funnelData] = await Promise.all([
          invokeApi(`/traceability/leads?${params}`),
          invokeApi('/traceability/campaigns'),
          invokeApi('/traceability/funnel')
        ])

        if (!isActive) return
        setRows(leadsData?.leads ?? [])
        setTotal(leadsData?.total ?? 0)
        setMatchedTotal(leadsData?.matchedTotal ?? null)
        setCampaigns(campaignsData?.campaigns ?? [])
        setFunnel(funnelData?.funnel ?? [])
      } catch (err: any) {
        if (!isActive) return
        setError(err?.message ?? 'Error cargando datos de trazabilidad.')
      } finally {
        if (isActive) setLoading(false)
      }
    }

    loadData()

    return () => {
      isActive = false
    }
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

  const matchedCount = matchedTotal !== null ? matchedTotal : rows.filter((r) => r.patient_id || r.doc_patient_id || r.doctoralia_template_name).length
  const withRevenueCount = rows.filter((r) => r.doctoralia_net && r.doctoralia_net > 0).length
  const totalRevenue = rows.reduce((s, r) => s + (r.doctoralia_net ?? 0), 0)

  const renderPatientInfo = (r: any) => {
    if (r.patient_name) {
      return <p className="text-foreground">{r.patient_name}</p>
    }
    if (r.doc_patient_id) {
      return <p className="text-muted text-[10px]">ID: {r.doc_patient_id}</p>
    }
    if (r.doctoralia_template_name) {
      return <p className="text-muted text-[10px] truncate max-w-[160px]">Cruzado por teléfono</p>
    }
    return <span className="text-muted">—</span>
  }

  const campaignColumns: ColDef[] = [
    { key: 'campaign_name', label: 'Campaña' },
    { key: 'source', label: 'Fuente' },
    { key: 'total_leads', label: 'Leads', align: 'right', sortable: true },
    { key: 'booked', label: 'Citas', align: 'right', sortable: true },
    { key: 'closed', label: 'Ventas', align: 'right', sortable: true },
    { key: 'lead_to_close_rate_pct', label: '% Conv.', align: 'right', sortable: true, format: (v) => `${v}%` },
    { key: 'verified_revenue_crm', label: 'Rev. CRM', align: 'right', sortable: true, format: (v) => `€${Number(v).toLocaleString('es-ES')}` },
  ]

  const funnelColumns: ColDef[] = [
    { key: 'cohort', label: 'Cohorte' },
    { key: 'lead_count', label: 'Leads', align: 'right', sortable: true },
    { key: 'avg_reply_delay_min', label: 'Retraso medio (min)', align: 'right', sortable: true },
    { key: 'verified_revenue_crm', label: 'Rev. CRM', align: 'right', sortable: true, format: (v) => `€${Number(v).toLocaleString('es-ES')}` },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Trazabilidad Avanzada</h1>
        <p className="text-muted mt-1">Trazabilidad de leads Meta → pacientes Doctoralia → ingresos verificados</p>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted uppercase tracking-wide">Total leads</p>
            <p className="text-2xl font-bold mt-1">{total > 0 ? total : rows.length}</p>
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

      <Tabs defaultValue="leads" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="leads" className="gap-2"><GitMerge className="h-4 w-4" />Cruces Doctoralia</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2"><TrendingUp className="h-4 w-4" />Rendimiento Real Campañas</TabsTrigger>
          <TabsTrigger value="funnel" className="gap-2"><MessageCircle className="h-4 w-4" />Embudo WhatsApp</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
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
                        const matched = Boolean(r.patient_id || r.doc_patient_id || r.doctoralia_template_name)
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
                              {renderPatientInfo(r)}
                              {r.doctoralia_template_name && (
                                <p className="text-muted text-[10px] truncate max-w-[140px]">{r.doctoralia_template_name}</p>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              {hasRevenue ? (
                                <span className="text-primary font-medium">
                                  €{r.doctoralia_net.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="py-2 text-right">
                              {r.days_to_settlement == null ? (
                                <span className="text-muted">—</span>
                              ) : (
                                <span className={r.days_to_settlement <= 30 ? 'text-green-400' : 'text-muted'}>
                                  {r.days_to_settlement}d
                                </span>
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
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Rendimiento por Campaña (Datos Reales CRM)</CardTitle>
            </CardHeader>
            <CardContent>
              <SortableTable
                columns={campaignColumns}
                rows={campaigns}
                loading={loading}
                emptyMessage="No hay datos de rendimiento de campañas todavía."
                exportFilename="rendimiento-campanas-real"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Embudo Real WhatsApp</CardTitle>
            </CardHeader>
            <CardContent>
              <SortableTable
                columns={funnelColumns}
                rows={funnel}
                loading={loading}
                emptyMessage="No hay datos del embudo de WhatsApp todavía."
                exportFilename="embudo-whatsapp-real"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
