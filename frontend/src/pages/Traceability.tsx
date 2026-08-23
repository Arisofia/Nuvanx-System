import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { GitMerge, Search, CheckCircle2, XCircle, TrendingUp, MessageCircle, Info } from 'lucide-react'
import { invokeApi } from '../lib/invokeApi'
import { SortableTable, type ColDef } from '../components/ui/SortableTable'
import TrazabilidadFunnelTableFinal from '../components/traceability/TrazabilidadFunnelTable_Final'

interface TraceRow {
  lead_id: string
  lead_name: string | null
  source: string | null
  campaign_name: string | null
  stage: string | null
  lead_created_at: string | null
  appointment_date: string | null
  patient_id: string | null
  patient_name: string | null
  phone_normalized: string | null
  doc_patient_id: string | null
  match_confidence: number | null
  match_class: string | null
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

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function Traceability() {
  const [from, setFrom] = useState<string>(() => {
    const d = new Date()
    return toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 1))
  })
  const [to, setTo] = useState<string>(() => toLocalDateInputValue(new Date()))
  const [rows, setRows] = useState<TraceRow[]>([])
  const [total, setTotal] = useState(0)
  const [matchedTotal, setMatchedTotal] = useState<number | null>(null)
  const [campaigns, setCampaigns] = useState<any[]>([])
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
        if (from) params.set('from', from)
        if (to) params.set('to', to)

        const [leadsData, campaignsData] = await Promise.all([
          invokeApi<any>(`/api/traceability/leads?${params}`),
          invokeApi<any>(`/api/traceability/campaigns?${params}`),
        ])

        if (!isActive) return
        setRows(leadsData?.leads ?? [])
        setTotal(leadsData?.total ?? 0)
        setMatchedTotal(leadsData?.matchedTotal ?? null)
        setCampaigns(campaignsData?.campaigns ?? [])
      } catch (err: any) {
        if (!isActive) return
        setError(err?.message ?? 'Error cargando datos de trazabilidad.')
      } finally {
        if (isActive) setLoading(false)
      }
    }

    void loadData()
    return () => { isActive = false }
  }, [matchedOnly, from, to])

  const filtered = rows.filter((row) => {
    if (search === '') return true
    const query = search.toLowerCase()
    return row.lead_name?.toLowerCase().includes(query)
      || row.patient_name?.toLowerCase().includes(query)
      || row.campaign_name?.toLowerCase().includes(query)
      || row.doc_patient_id?.toLowerCase().includes(query)
  })

  // Summary cards must not be derived from the paginated rows array (max 500).
  // The API already returns exact period-level counts for total and matchedTotal.
  const exactTotal = total > 0 ? total : rows.length
  const matchedCount = matchedTotal ?? rows.filter((row) => row.patient_id || row.doc_patient_id || row.doctoralia_template_name).length
  const unmatchedCount = Math.max(exactTotal - matchedCount, 0)
  const matchCoverage = exactTotal > 0 ? (matchedCount / exactTotal) * 100 : 0

  const renderPatientInfo = (row: TraceRow) => {
    if (row.patient_name) return <p className="text-foreground">{row.patient_name}</p>
    if (row.doc_patient_id) return <p className="text-muted text-[10px]">ID: {row.doc_patient_id}</p>
    if (row.doctoralia_template_name) {
      return <p className="text-muted text-[10px]">{row.phone_normalized ? 'Cruzado por teléfono' : 'Cruzado por nombre'}</p>
    }
    return <span className="text-muted">—</span>
  }

  const campaignColumns: ColDef[] = [
    { key: 'campaign_name', label: 'Campaña' },
    { key: 'source', label: 'Fuente' },
    { key: 'total_leads', label: 'Leads', align: 'right', sortable: true },
    { key: 'booked', label: 'Cruces Doctoralia', align: 'right', sortable: true },
  ]

  const setThisMonth = () => {
    const d = new Date()
    setFrom(toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 1)))
    setTo(toLocalDateInputValue(d))
  }

  const setLastMonth = () => {
    const d = new Date()
    setFrom(toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth() - 1, 1)))
    setTo(toLocalDateInputValue(new Date(d.getFullYear(), d.getMonth(), 0)))
  }

  return (
    <div className="space-y-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="space-y-2">
          <h1 className="text-5xl font-serif font-bold tracking-tight text-[#2C2825]">Trazabilidad</h1>
          <p className="text-[#5C5550] text-xs uppercase tracking-[0.4em] font-bold">Cruce operativo de leads y citas</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-white/80 backdrop-blur-xl p-1 rounded-xl border border-[#E5D5C5]/60 shadow-sm">
            <button onClick={setThisMonth} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5">Este mes</button>
            <button onClick={setLastMonth} className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all text-[#8E8680] hover:text-[#84643B] hover:bg-[#84643B]/5">Mes pasado</button>
          </div>
          <div className="flex items-center gap-2 bg-white/80 backdrop-blur-xl p-1.5 rounded-xl border border-[#E5D5C5]/60 shadow-sm">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="bg-transparent border-none text-[10px] font-bold uppercase tracking-wider focus:ring-0 cursor-pointer outline-none w-32" />
            <span className="text-[#B08B5A]/40 text-xs">→</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="bg-transparent border-none text-[10px] font-bold uppercase tracking-wider focus:ring-0 cursor-pointer outline-none w-32" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[#E0A020]/30 bg-[#E0A020]/10 p-4 flex gap-3">
        <Info className="h-5 w-5 text-[#E0A020] flex-shrink-0 mt-0.5" />
        <p className="text-sm text-[#5C5550]">Los importes procedentes de Doctoralia se identifican como datos fuente de cita y no como cobro, ingreso o caja reconciliada.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-none shadow-sm bg-white"><CardContent className="pt-8"><p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Total leads</p><p className="text-4xl font-serif font-bold mt-4 text-[#2C2825]">{exactTotal}</p></CardContent></Card>
        <Card className="border-none shadow-sm bg-white"><CardContent className="pt-8"><p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Cruces Doctoralia</p><div className="flex items-center gap-3 mt-4"><p className="text-4xl font-serif font-bold text-green-600">{matchedCount}</p><CheckCircle2 className="h-5 w-5 text-green-600/30" /></div></CardContent></Card>
        <Card className="border-none shadow-sm bg-white"><CardContent className="pt-8"><p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Leads sin cruce</p><p className="text-4xl font-serif font-bold mt-4 text-primary">{unmatchedCount}</p></CardContent></Card>
        <Card className="border-none shadow-sm bg-white"><CardContent className="pt-8"><p className="text-[10px] font-bold text-[#5C5550] uppercase tracking-[0.2em]">Cobertura de cruce</p><p className="text-4xl font-serif font-bold mt-4 text-primary">{matchCoverage.toFixed(1)}%</p><p className="text-[10px] text-[#8E8680] mt-2">Sobre el periodo completo</p></CardContent></Card>
      </div>

      <Tabs defaultValue="leads" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="leads" className="gap-2"><GitMerge className="h-4 w-4" />Cruces Doctoralia</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2"><TrendingUp className="h-4 w-4" />Cruce por campaña</TabsTrigger>
          <TabsTrigger value="funnel" className="gap-2"><MessageCircle className="h-4 w-4" />Funnel operativo</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Card className="border-none shadow-md bg-white overflow-hidden">
            <CardHeader className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-border/10">
              <div><CardTitle className="font-serif text-2xl text-[#2C2825]">Listado de trazabilidad</CardTitle><p className="text-xs text-[#5C5550] mt-1">Cruce directo de leads y registros de clínica</p></div>
              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <button onClick={() => setMatchedOnly((value) => !value)} className={`px-4 py-2 rounded-xl text-xs font-bold border ${matchedOnly ? 'bg-green-600 text-white border-green-700' : 'bg-white text-[#5C5550] border-border/40'}`}><CheckCircle2 className="h-3.5 w-3.5 inline mr-2" />Solo cruzados</button>
                <div className="relative flex-1 sm:flex-none"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8E8680]" /><input type="text" placeholder="Buscar lead o paciente…" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-10 pr-4 py-2.5 text-sm bg-[#FAF7F2]/40 border border-border/30 rounded-xl w-full sm:w-64" /></div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {loading && <p className="text-sm text-[#8E8680] py-12 text-center">Cargando trazabilidad…</p>}
              {!loading && error && <p className="text-sm text-[#D9534F] py-12 text-center">{error}</p>}
              {!loading && !error && filtered.length === 0 && <p className="text-sm text-[#5C5550] py-12 text-center">{rows.length === 0 ? 'Aún no hay leads registrados.' : 'Ningún resultado para la búsqueda actual.'}</p>}
              {!loading && !error && filtered.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="border-b border-border/10 text-[#5C5550] uppercase tracking-[0.15em] text-[10px] font-bold"><th className="text-left py-4 pr-4">Lead</th><th className="text-left py-4 pr-4">Fuente / Campaña</th><th className="text-left py-4 pr-4">Fecha cita</th><th className="text-left py-4 pr-4">Estado cruce</th><th className="text-left py-4 pr-4">Paciente Doctoralia</th><th className="text-right py-4 pr-4">Importe cita (fuente)</th><th className="text-right py-4">Días desde lead</th></tr></thead>
                    <tbody className="divide-y divide-border/5">
                      {filtered.map((row) => {
                        const matched = Boolean(row.patient_id || row.doc_patient_id || row.doctoralia_template_name)
                        const hasSourceAmount = row.doctoralia_net != null && Number(row.doctoralia_net) !== 0
                        const matchLabel = row.match_class ? (MATCH_LABELS[row.match_class] ?? row.match_class) : 'Cruzado'
                        return (
                          <tr key={row.lead_id} className="hover:bg-[#FAF7F2]/60 transition-colors">
                            <td className="py-5 pr-4"><p className="font-serif font-bold text-[#2C2825] text-sm">{row.lead_name ?? '—'}</p>{row.stage && <span className="text-[9px] text-primary uppercase">{row.stage}</span>}</td>
                            <td className="py-5 pr-4"><p className="font-semibold">{row.source ?? '—'}</p>{row.campaign_name && <p className="text-[#5C5550] text-[10px] mt-1">{row.campaign_name}</p>}</td>
                            <td className="py-5 pr-4">{row.appointment_date ? new Date(row.appointment_date).toLocaleDateString('es-ES') : '—'}</td>
                            <td className="py-5 pr-4">{matched ? <span className="text-green-600 font-bold"><CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />{matchLabel}</span> : <span className="text-[#8E8680]"><XCircle className="h-3.5 w-3.5 inline mr-1" />Sin cruce</span>}</td>
                            <td className="py-5 pr-4">{renderPatientInfo(row)}{row.doctoralia_template_name && <p className="text-[#5C5550] text-[10px] mt-1">{row.doctoralia_template_name}</p>}</td>
                            <td className="py-5 pr-4 text-right">{hasSourceAmount ? <span title="Importe de la fuente Doctoralia; no equivale a un cobro conciliado">€{Number(row.doctoralia_net).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</span> : '—'}</td>
                            <td className="py-5 text-right">{row.days_to_settlement == null ? '—' : `${row.days_to_settlement}d`}</td>
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

        <TabsContent value="campaigns" className="mt-4"><Card><CardHeader><CardTitle>Cruces Doctoralia por campaña</CardTitle></CardHeader><CardContent><SortableTable columns={campaignColumns} rows={campaigns} loading={loading} emptyMessage="No hay datos de cruce por campaña todavía." exportFilename="cruces-doctoralia-por-campana" /></CardContent></Card></TabsContent>
        <TabsContent value="funnel" className="mt-4"><TrazabilidadFunnelTableFinal /></TabsContent>
      </Tabs>
    </div>
  )
}
