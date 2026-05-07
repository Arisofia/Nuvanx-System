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
  phone_normalized: string | null
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
    if (search === '') return true
    const q = search.toLowerCase()
    return (
      r.lead_name?.toLowerCase().includes(q) ||
      r.patient_name?.toLowerCase().includes(q) ||
      r.campaign_name?.toLowerCase().includes(q) ||
      r.doc_patient_id?.toLowerCase().includes(q)
    )
  })

  const matchedCount = matchedTotal ?? rows.filter((r) => r.patient_id || r.doc_patient_id || r.doctoralia_template_name).length
  const withRevenueCount = rows.filter((r) => r.doctoralia_net && r.doctoralia_net > 0).length
  const totalRevenue = rows.reduce((s, r) => s + (r.doctoralia_net ?? 0), 0)

  const renderPatientInfo = (r: any) => {
    if (r.patient_name) {
      return <p className="text-foreground">{r.patient_name}</p>
    }
    if (r.doc_patient_id) {
      return <p className="text-muted text-[10px]">ID: {r.doc_patient_id}</p>
    }
    if (r.doctoralia_template_name && !r.doc_patient_id) {
      const label = r.phone_normalized ? 'Cruzado por teléfono' : 'Cruzado por nombre'
      return <p className="text-muted text-[10px] truncate max-w-[160px]">{label}</p>
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
        <h1 className="text-4xl font-serif font-bold text-foreground tracking-tight">Trazabilidad Avanzada</h1>
        <p className="text-muted text-lg mt-2 font-medium">Trazabilidad de leads Meta → pacientes Doctoralia → ingresos verificados</p>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Total leads</p>
            <p className="text-3xl font-bold mt-2 tracking-tight">{total > 0 ? total : rows.length}</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Cruzados Doctoralia</p>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-3xl font-bold tracking-tight text-green-500">{matchedCount}</p>
              <CheckCircle2 className="h-5 w-5 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Ventas Verificadas</p>
            <div className="flex items-center gap-2 mt-2">
              <p className="text-3xl font-bold tracking-tight text-primary">{withRevenueCount}</p>
              <TrendingUp className="h-5 w-5 text-primary/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="pt-6">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider">Ingresos Totales</p>
            <p className="text-3xl font-bold mt-2 tracking-tight text-primary">
              {totalRevenue > 0 ? `€${totalRevenue.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
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
            <CardHeader className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0 pb-6 border-b border-border/50">
              <div>
                <CardTitle className="flex items-center gap-2 font-serif text-xl">
                  <GitMerge className="h-5 w-5 text-primary" />
                  Listado de Trazabilidad
                </CardTitle>
                <p className="text-xs text-muted font-medium mt-1">Cruce directo de leads y registros de clínica</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                {/* Matched only toggle */}
                <button
                  onClick={() => setMatchedOnly((v) => !v)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm border ${
                    matchedOnly 
                      ? 'bg-green-500 text-white border-green-600' 
                      : 'bg-surface text-muted hover:text-foreground border-border'
                  }`}
                >
                  <CheckCircle2 className={`h-3.5 w-3.5 ${matchedOnly ? 'text-white' : 'text-muted'}`} />
                  Solo cruzados
                </button>
                {/* Search */}
                <div className="relative flex-1 sm:flex-none">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Buscar lead o paciente…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 pr-4 py-2 text-sm bg-surface border border-border rounded-xl w-full sm:w-64 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
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
                      <tr className="border-b border-border text-muted uppercase tracking-tighter text-[10px] font-bold">
                        <th className="text-left py-3 pr-4">Lead</th>
                        <th className="text-left py-3 pr-4">Fuente / Campaña</th>
                        <th className="text-left py-3 pr-4">Fecha</th>
                        <th className="text-left py-3 pr-4">Estado Cruce</th>
                        <th className="text-left py-3 pr-4">Paciente Doctoralia</th>
                        <th className="text-right py-3 pr-4">Ingreso €</th>
                        <th className="text-right py-3">Liquidación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {filtered.map((r) => {
                        const matched = Boolean(r.patient_id || r.doc_patient_id || r.doctoralia_template_name)
                        const hasRevenue = r.doctoralia_net && r.doctoralia_net > 0
                        let matchLabel = 'Cruzado'
                        if (r.match_class) {
                          matchLabel = MATCH_LABELS[r.match_class] ?? r.match_class
                        } else if (r.doctoralia_template_name && r.doc_patient_id == null) {
                          matchLabel = r.phone_normalized ? 'Por teléfono' : 'Por nombre'
                        }
                        return (
                          <tr key={r.lead_id} className="group hover:bg-surface transition-colors">
                            <td className="py-4 pr-4">
                              <p className="font-bold text-foreground text-sm">{r.lead_name ?? '—'}</p>
                              {r.stage && (
                                <span className="text-[10px] font-bold text-primary uppercase bg-primary/5 px-1.5 py-0.5 rounded mt-1 inline-block border border-primary/10">{r.stage}</span>
                              )}
                            </td>
                            <td className="py-4 pr-4">
                              <p className="text-foreground font-medium">{r.source ?? '—'}</p>
                              {r.campaign_name && (
                                <p className="text-muted text-[10px] font-medium truncate max-w-[160px] mt-1" title={r.campaign_name}>{r.campaign_name}</p>
                              )}
                            </td>
                            <td className="py-4 pr-4 text-muted font-medium whitespace-nowrap">
                              {r.lead_created_at
                                ? new Date(r.lead_created_at).toLocaleDateString('es-ES')
                                : '—'}
                            </td>
                            <td className="py-4 pr-4">
                              {matched ? (
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5 text-green-500 font-bold">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>{matchLabel}</span>
                                  </div>
                                  {r.match_confidence != null && (
                                    <div className="w-24 bg-border/40 h-1 rounded-full overflow-hidden mt-1">
                                      <div 
                                        className="bg-green-500 h-full rounded-full transition-all" 
                                        style={{ width: `${Math.round(r.match_confidence * 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-muted/60 font-medium">
                                  <XCircle className="h-3.5 w-3.5" />
                                  <span>Sin cruce</span>
                                </div>
                              )}
                            </td>
                            <td className="py-4 pr-4">
                              <div className="flex flex-col gap-1">
                                <div className="font-bold text-foreground">{renderPatientInfo(r)}</div>
                                {r.doctoralia_template_name && (
                                  <p className="text-muted text-[10px] font-medium truncate max-w-[140px] italic border-l-2 border-primary/20 pl-2">{r.doctoralia_template_name}</p>
                                )}
                              </div>
                            </td>
                            <td className="py-4 pr-4 text-right">
                              {hasRevenue ? (
                                <span className="text-primary font-bold text-base">
                                  €{r.doctoralia_net.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                              ) : (
                                <span className="text-muted/40 font-medium">—</span>
                              )}
                            </td>
                            <td className="py-4 text-right">
                              {r.days_to_settlement == null ? (
                                <span className="text-muted/40 font-medium">—</span>
                              ) : (
                                <div className="flex flex-col items-end gap-1">
                                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.days_to_settlement <= 30 ? 'bg-green-500/10 text-green-500' : 'bg-muted/10 text-muted'}`}>
                                    {r.days_to_settlement}d
                                  </span>
                                  <span className="text-[10px] text-muted font-medium">tras lead</span>
                                </div>
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
