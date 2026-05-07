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
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">Trazabilidad</h1>
          <p className="text-[#5C5550] text-xs uppercase tracking-[0.4em] font-bold">Auditoría y Conversión Real</p>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Total leads</p>
            <p className="text-4xl font-serif font-bold mt-4 tracking-tight text-[#2C2825]">{total > 0 ? total : rows.length}</p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Cruzados Doctoralia</p>
            <div className="flex items-center gap-3 mt-4">
              <p className="text-4xl font-serif font-bold tracking-tight text-green-600">{matchedCount}</p>
              <CheckCircle2 className="h-5 w-5 text-green-600/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Ventas Verificadas</p>
            <div className="flex items-center gap-3 mt-4">
              <p className="text-4xl font-serif font-bold tracking-tight text-primary">{withRevenueCount}</p>
              <TrendingUp className="h-5 w-5 text-primary/30" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover:shadow-xl transition-all duration-500 border-none shadow-sm bg-white">
          <CardContent className="pt-8">
            <p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Ingresos Totales</p>
            <p className="text-4xl font-serif font-bold mt-4 tracking-tight text-primary">
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
          <Card className="border-none shadow-md bg-white overflow-hidden">
            <CardHeader className="flex flex-col sm:flex-row items-center justify-between space-y-4 sm:space-y-0 pb-6 border-b border-border/10">
              <div>
                <CardTitle className="flex items-center gap-2 font-serif text-2xl text-[#2C2825]">
                  <GitMerge className="h-5 w-5 text-primary" />
                  Listado de Trazabilidad
                </CardTitle>
                <p className="text-xs text-[#5C5550] font-medium mt-1">Cruce directo de leads y registros de clínica</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                {/* Matched only toggle */}
                <button
                  onClick={() => setMatchedOnly((v) => !v)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm border ${
                    matchedOnly 
                      ? 'bg-green-600 text-white border-green-700' 
                      : 'bg-white text-[#5C5550] hover:text-[#2C2825] border-border/40 hover:border-primary/40'
                  }`}
                >
                  <CheckCircle2 className={`h-3.5 w-3.5 ${matchedOnly ? 'text-white' : 'text-[#8E8680]'}`} />
                  Solo cruzados
                </button>
                {/* Search */}
                <div className="relative flex-1 sm:flex-none">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8E8680] pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Buscar lead o paciente…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 pr-4 py-2.5 text-sm bg-[#FAF7F2]/40 border border-border/30 rounded-xl w-full sm:w-64 text-[#2C2825] placeholder:text-[#8E8680] focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {loading && (
                <p className="text-sm text-[#8E8680] py-12 text-center animate-pulse italic">Cargando trazabilidad…</p>
              )}
              {!loading && error && (
                <p className="text-sm text-[#D9534F] py-12 text-center font-medium bg-red-50/50 rounded-2xl">{error}</p>
              )}
              {!loading && !error && filtered.length === 0 && (
                <div className="py-16 text-center space-y-3">
                  <div className="bg-[#FAF7F2] w-16 h-16 rounded-full flex items-center justify-center mx-auto border border-border/20">
                    <GitMerge className="h-8 w-8 text-[#C9B9A8]" />
                  </div>
                  <p className="text-sm font-medium text-[#5C5550]">
                    {rows.length === 0
                      ? 'Aún no hay leads registrados.'
                      : 'Ningún resultado para la búsqueda actual.'}
                  </p>
                </div>
              )}
              {!loading && !error && filtered.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border/10 text-[#5C5550] uppercase tracking-[0.15em] text-[10px] font-bold">
                        <th className="text-left py-4 pr-4 pl-2 font-bold">Lead</th>
                        <th className="text-left py-4 pr-4 font-bold">Fuente / Campaña</th>
                        <th className="text-left py-4 pr-4 font-bold">Fecha</th>
                        <th className="text-left py-4 pr-4 font-bold">Estado Cruce</th>
                        <th className="text-left py-4 pr-4 font-bold">Paciente Doctoralia</th>
                        <th className="text-right py-4 pr-4 font-bold">Ingreso €</th>
                        <th className="text-right py-4 pr-2 font-bold">Liquidación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/5">
                      {filtered.map((r, idx) => {
                        const matched = Boolean(r.patient_id || r.doc_patient_id || r.doctoralia_template_name)
                        const hasRevenue = r.doctoralia_net && r.doctoralia_net > 0
                        let matchLabel = 'Cruzado'
                        if (r.match_class) {
                          matchLabel = MATCH_LABELS[r.match_class] ?? r.match_class
                        } else if (r.doctoralia_template_name && r.doc_patient_id == null) {
                          matchLabel = r.phone_normalized ? 'Por teléfono' : 'Por nombre'
                        }
                        return (
                          <tr key={r.lead_id} className={`group hover:bg-[#FAF7F2]/60 transition-colors ${idx % 2 === 0 ? 'bg-transparent' : 'bg-[#FAF7F2]/20'}`}>
                            <td className="py-5 pr-4 pl-2">
                              <p className="font-serif font-bold text-[#2C2825] text-sm">{r.lead_name ?? '—'}</p>
                              {r.stage && (
                                <span className="text-[9px] font-bold text-primary uppercase bg-primary/5 px-2 py-0.5 rounded mt-1.5 inline-block border border-primary/10 tracking-widest">{r.stage}</span>
                              )}
                            </td>
                            <td className="py-5 pr-4">
                              <p className="text-[#2C2825] font-semibold">{r.source ?? '—'}</p>
                              {r.campaign_name && (
                                <p className="text-[#5C5550] text-[10px] font-medium truncate max-w-[180px] mt-1.5" title={r.campaign_name}>{r.campaign_name}</p>
                              )}
                            </td>
                            <td className="py-5 pr-4 text-[#5C5550] font-bold whitespace-nowrap">
                              {r.lead_created_at
                                ? new Date(r.lead_created_at).toLocaleDateString('es-ES')
                                : '—'}
                            </td>
                            <td className="py-5 pr-4">
                              {matched ? (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex items-center gap-1.5 text-green-600 font-bold tracking-tight">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    <span>{matchLabel}</span>
                                  </div>
                                  {r.match_confidence != null && (
                                    <div className="w-24 bg-border/20 h-1 rounded-full overflow-hidden mt-0.5">
                                      <div 
                                        className="bg-green-600 h-full rounded-full transition-all" 
                                        style={{ width: `${Math.round(r.match_confidence * 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[#C9B9A8] font-bold">
                                  <XCircle className="h-3.5 w-3.5 opacity-40" />
                                  <span>Sin cruce</span>
                                </div>
                              )}
                            </td>
                            <td className="py-5 pr-4">
                              <div className="flex flex-col gap-1.5">
                                <div className="font-serif font-bold text-[#2C2825]">{renderPatientInfo(r)}</div>
                                {r.doctoralia_template_name && (
                                  <p className="text-[#5C5550] text-[10px] font-medium truncate max-w-[140px] italic border-l-2 border-primary/20 pl-2 leading-tight">{r.doctoralia_template_name}</p>
                                )}
                              </div>
                            </td>
                            <td className="py-5 pr-4 text-right">
                              {hasRevenue ? (
                                <span className="text-[#2C2825] font-serif font-bold text-base tracking-tight">
                                  €{r.doctoralia_net.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                              ) : (
                                <span className="text-[#C9B9A8] font-medium opacity-40">—</span>
                              )}
                            </td>
                            <td className="py-5 text-right pr-2">
                              {r.days_to_settlement == null ? (
                                <span className="text-[#C9B9A8] font-medium opacity-40">—</span>
                              ) : (
                                <div className="flex flex-col items-end gap-1.5">
                                  <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${r.days_to_settlement <= 30 ? 'bg-green-600/5 text-green-600 border-green-600/20' : 'bg-[#FAF7F2] text-[#8E8680] border-border/40'}`}>
                                    {r.days_to_settlement}d
                                  </span>
                                  <span className="text-[9px] text-[#8E8680] font-bold uppercase tracking-wider">tras lead</span>
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
