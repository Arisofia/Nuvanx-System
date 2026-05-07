import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AlertCircle, FileBarChart2, TrendingUp, Users, MessageCircle, Stethoscope, BarChart3, CheckCircle2, XCircle } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import { ExportButton } from '../components/reports/ExportButton'
import { FilterBar } from '../components/ui/FilterBar'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'
import logo from '../assets/logo.png'

function EmptyState({ message }: Readonly<{ message: string }>) {
  return <p className="text-muted text-sm py-8 text-center">{message}</p>
}

function ErrorState({ message }: Readonly<{ message: string }>) {
  return (
    <div className="p-4 bg-[#D9534F]/8 border border-[#D9534F]/30 rounded-lg flex gap-3">
      <AlertCircle className="w-5 h-5 text-[#D9534F] shrink-0 mt-0.5" />
      <p className="text-sm text-[#D9534F]">{message}</p>
    </div>
  )
}

function TableHead({ cols }: Readonly<{ cols: string[] }>) {
  return (
    <thead>
      <tr className="border-b border-border">
        {cols.map((c) => (
          <th key={c} className="text-left text-xs font-semibold text-muted px-3 py-2 whitespace-nowrap">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function TableRow({ cells }: Readonly<{ cells: (string | number | null | undefined)[] }>) {
  return (
    <tr className="border-b border-[#2d2218] hover:bg-card/50 transition-colors">
      {cells.map((c, i) => (
        <td key={`${c}-${i}`} className="px-3 py-2 text-sm text-[#d7c5ae] whitespace-nowrap">
          {c ?? '—'}
        </td>
      ))}
    </tr>
  )
}

function pct(n: number | null | undefined) {
  return n == null ? '—' : `${n}%`
}
function curr(n: number | null | undefined) {
  return n == null
    ? '—'
    : n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export default function Reports() {
  // Doctoralia Financials
  const [docData, setDocData] = useState<{ templateSummary: any[]; byMonth: any[] } | null>(null)
  const [docLoading, setDocLoading] = useState(true)
  const [docError, setDocError] = useState<string | null>(null)
  const [docFrom, setDocFrom] = useState<string>('')
  const [docTo, setDocTo] = useState<string>('')

  // Campaign Performance
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [campLoading, setCampLoading] = useState(true)
  const [campError, setCampError] = useState<string | null>(null)
  const [campFrom, setCampFrom] = useState<string>('')
  const [campTo, setCampTo] = useState<string>('')

  // Source Comparison
  const [sources, setSources] = useState<any[]>([])
  const [srcLoading, setSrcLoading] = useState(true)
  const [srcError, setSrcError] = useState<string | null>(null)
  const [srcFrom, setSrcFrom] = useState<string>('')
  const [srcTo, setSrcTo] = useState<string>('')

  // WhatsApp Conversion
  const [cohorts, setCohorts] = useState<any[]>([])
  const [waLoading, setWaLoading] = useState(true)
  const [waError, setWaError] = useState<string | null>(null)

  // Doctor Performance
  const [doctors, setDoctors] = useState<any[]>([])
  const [docPerfLoading, setDocPerfLoading] = useState(true)
  const [docPerfError, setDocPerfError] = useState<string | null>(null)

  // Campaign ROI
  const [roiRows, setRoiRows] = useState<any[]>([])
  const [roiLoading, setRoiLoading] = useState(true)
  const [roiError, setRoiError] = useState<string | null>(null)
  const [roiFrom, setRoiFrom] = useState<string>('')
  const [roiTo, setRoiTo] = useState<string>('')
  const [roiSource, setRoiSource] = useState<string>('')

  // Lead Audit
  const [leadAuditRows, setLeadAuditRows] = useState<any[]>([])
  const [leadAuditLoading, setLeadAuditLoading] = useState(true)
  const [leadAuditError, setLeadAuditError] = useState<string | null>(null)
  const [leadAuditMatchedOnly, setLeadAuditMatchedOnly] = useState(false)
  const [leadAuditFrom, setLeadAuditFrom] = useState<string>('')
  const [leadAuditTo, setLeadAuditTo] = useState<string>('')
  const [leadAuditCampaignName, setLeadAuditCampaignName] = useState<string>('')
  const [leadAuditPhone, setLeadAuditPhone] = useState<string>('')

  // Doctoralia fetch — re-runs on date filter change
  useEffect(() => {
    const params: string[] = []
    if (docFrom) params.push(`from=${docFrom}`)
    if (docTo) params.push(`to=${docTo}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    invokeApi(`/reports/doctoralia-financials${qs}`)
      .then((d: any) => {
        setDocError(null)
        setDocData({ templateSummary: d?.templateSummary ?? [], byMonth: d?.byMonth ?? [] })
      })
      .catch((e: any) => setDocError(e?.message || 'Failed to load Doctoralia financials.'))
      .finally(() => setDocLoading(false))
  }, [docFrom, docTo])

  useEffect(() => {
    invokeApi('/reports/whatsapp-conversion')
      .then((d: any) => setCohorts(d?.cohorts ?? []))
      .catch((e: any) => setWaError(e?.message || 'Failed to load WhatsApp conversion.'))
      .finally(() => setWaLoading(false))

    invokeApi('/reports/doctor-performance')
      .then((d: any) => setDoctors(d?.doctors ?? []))
      .catch((e: any) => setDocPerfError(e?.message || 'Failed to load doctor performance.'))
      .finally(() => setDocPerfLoading(false))
  }, [])

  useEffect(() => {
    const loadCampaignPerformance = async () => {
      setCampLoading(true)
      setCampError(null)
      const params: string[] = []
      if (campFrom) params.push(`from=${campFrom}`)
      if (campTo) params.push(`to=${campTo}`)
      const qs = params.length ? `?${params.join('&')}` : ''
      try {
        const d: any = await invokeApi(`/reports/campaign-performance${qs}`)
        setCampaigns(d?.campaigns ?? [])
      } catch (e: any) {
        setCampError(e?.message || 'Failed to load campaign performance.')
      } finally {
        setCampLoading(false)
      }
    }
    loadCampaignPerformance()
  }, [campFrom, campTo])

  useEffect(() => {
    const loadSourceComparison = async () => {
      setSrcLoading(true)
      setSrcError(null)
      const params: string[] = []
      if (srcFrom) params.push(`from=${srcFrom}`)
      if (srcTo) params.push(`to=${srcTo}`)
      const qs = params.length ? `?${params.join('&')}` : ''
      try {
        const d: any = await invokeApi(`/reports/source-comparison${qs}`)
        setSources(d?.sources ?? [])
      } catch (e: any) {
        setSrcError(e?.message || 'Failed to load source comparison.')
      } finally {
        setSrcLoading(false)
      }
    }
    loadSourceComparison()
  }, [srcFrom, srcTo])

  // Campaign ROI — re-runs on filter change
  useEffect(() => {
    const params: string[] = []
    if (roiFrom)   params.push(`from=${roiFrom}`)
    if (roiTo)     params.push(`to=${roiTo}`)
    if (roiSource) params.push(`source=${encodeURIComponent(roiSource)}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    let cancelled = false
    invokeApi(`/reports/campaign-roi${qs}`)
      .then((d: any) => { if (!cancelled) { setRoiError(null); setRoiRows(d?.rows ?? []); setRoiLoading(false) } })
      .catch((e: any) => { if (!cancelled) { setRoiError(e?.message || 'Failed to load campaign ROI.'); setRoiLoading(false) } })
    return () => { cancelled = true }
  }, [roiFrom, roiTo, roiSource])

  useEffect(() => {
    const params: string[] = []
    if (leadAuditMatchedOnly) params.push('matched=true')
    if (leadAuditFrom) params.push(`from=${leadAuditFrom}`)
    if (leadAuditTo) params.push(`to=${leadAuditTo}`)
    if (leadAuditCampaignName) params.push(`campaign_name=${encodeURIComponent(leadAuditCampaignName)}`)
    if (leadAuditPhone) params.push(`phone=${encodeURIComponent(leadAuditPhone)}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    let cancelled = false
    setLeadAuditLoading(true)
    setLeadAuditError(null)
    invokeApi(`/reports/lead-audit${qs}`)
      .then((d: any) => { if (!cancelled) { setLeadAuditRows(d?.leads ?? []); setLeadAuditError(null) } })
      .catch((e: any) => { if (!cancelled) setLeadAuditError(e?.message || 'Failed to load lead audit.') })
      .finally(() => { if (!cancelled) setLeadAuditLoading(false) })
    return () => { cancelled = true }
  }, [leadAuditMatchedOnly, leadAuditFrom, leadAuditTo, leadAuditCampaignName, leadAuditPhone])

  // Local date filters for campaign/source (front-end only)
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((r) => {
      if (campFrom && r.last_lead_at && r.last_lead_at < campFrom) return false
      if (campTo && r.first_lead_at && r.first_lead_at > campTo) return false
      return true
    })
  }, [campaigns, campFrom, campTo])

  const filteredSources = useMemo(() => {
    return sources.filter((r) => {
      if (srcFrom && r.last_lead_at && r.last_lead_at < srcFrom) return false
      if (srcTo && r.first_lead_at && r.first_lead_at > srcTo) return false
      return true
    })
  }, [sources, srcFrom, srcTo])

  const roiSources = useMemo(
    () => [...new Set(roiRows.map((r) => r.source).filter(Boolean))] as string[],
    [roiRows],
  )

  const roiColumns: ColDef[] = [
    { key: 'month', label: 'Mes', align: 'left', sortable: true },
    { key: 'source', label: 'Fuente', align: 'left', sortable: true },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    { key: 'leads_count', label: 'Leads', align: 'right', sortable: true },
    { key: 'patients_count', label: 'Pacientes', align: 'right', sortable: true },
    { key: 'net_revenue', label: 'Revenue neto', align: 'right', sortable: true,
      format: (v) => v == null ? null : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
    { key: 'spend', label: 'Spend Meta', align: 'right', sortable: true,
      format: (v) => v == null ? null : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
    { key: 'cac', label: 'CAC', align: 'right', sortable: true,
      format: (v) => v == null ? null : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
  ]

  return (
    <div className="space-y-12">
      <div className="flex flex-col items-center text-center space-y-6 mb-12">
        <div className="flex flex-col items-center space-y-4">
          <img src={logo} alt="Nuvanx Logo" className="h-20 w-auto" />
          <div className="space-y-2">
            <h1 className="text-5xl font-serif font-bold tracking-tight text-primary">Reportes</h1>
            <p className="text-muted text-sm uppercase tracking-[0.3em] font-bold">Inteligencia y Operación de Negocio</p>
          </div>
        </div>
        
        <div className="diamond-separator">
          <div className="diamond-separator-icon" />
        </div>
      </div>

      <Tabs defaultValue="doctoralia" className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-2 bg-transparent p-0 mb-6">
          {[
            { value: 'doctoralia', label: 'Doctoralia', icon: FileBarChart2 },
            { value: 'campaigns', label: 'Campaigns', icon: TrendingUp },
            { value: 'sources', label: 'Sources', icon: Users },
            { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
            { value: 'lead-audit', label: 'Lead Audit', icon: FileBarChart2 },
            { value: 'doctors', label: 'Doctors', icon: Stethoscope },
            { value: 'campaign-roi', label: 'Campaign ROI', icon: BarChart3 },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface text-muted data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary transition-all font-bold text-xs shadow-sm hover:text-foreground"
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="lead-audit" className="mt-0 space-y-6">
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/50 pb-6">
              <div>
                <CardTitle className="font-serif text-xl flex items-center gap-2">
                  <FileBarChart2 className="h-5 w-5 text-primary" />
                  Lead Audit
                </CardTitle>
                <p className="text-xs text-muted font-medium mt-1">Filtra y revisa la trazabilidad de leads contra Doctoralia.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex items-center gap-3 bg-surface/50 px-4 py-2 rounded-xl border border-border cursor-pointer hover:bg-surface transition-colors">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary transition-all"
                    checked={leadAuditMatchedOnly}
                    onChange={(event) => setLeadAuditMatchedOnly(event.target.checked)}
                  />
                  <span className="text-xs font-bold text-foreground">Solo cruzados</span>
                </label>
              </div>
            </CardHeader>
            <CardContent className="pt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <label htmlFor="lead-audit-campaign-name" className="text-[10px] font-bold text-muted uppercase tracking-wider">Campaña</label>
                <input
                  id="lead-audit-campaign-name"
                  type="text"
                  value={leadAuditCampaignName}
                  onChange={(event) => setLeadAuditCampaignName(event.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted/50"
                  placeholder="campaign_name"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="lead-audit-phone" className="text-[10px] font-bold text-muted uppercase tracking-wider">Teléfono</label>
                <input
                  id="lead-audit-phone"
                  type="text"
                  value={leadAuditPhone}
                  onChange={(event) => setLeadAuditPhone(event.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted/50"
                  placeholder="phone"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="lead-audit-from" className="text-[10px] font-bold text-muted uppercase tracking-wider">Desde</label>
                <input
                  id="lead-audit-from"
                  type="date"
                  value={leadAuditFrom}
                  onChange={(event) => setLeadAuditFrom(event.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="lead-audit-to" className="text-[10px] font-bold text-muted uppercase tracking-wider">Hasta</label>
                <input
                  id="lead-audit-to"
                  type="date"
                  value={leadAuditTo}
                  onChange={(event) => setLeadAuditTo(event.target.value)}
                  className="w-full px-4 py-2 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="border-b border-border/50 pb-6">
              <CardTitle className="font-serif text-xl">Resultados Lead Audit</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {leadAuditLoading && (
                <div className="py-20 flex flex-col items-center justify-center gap-3">
                  <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                  <p className="text-sm text-muted font-bold uppercase tracking-widest italic">Analizando trazabilidad…</p>
                </div>
              )}
              {leadAuditError && <ErrorState message={leadAuditError} />}
              {!leadAuditLoading && !leadAuditError && leadAuditRows.length === 0 && (
                <EmptyState message="No se encontraron leads con los filtros aplicados." />
              )}
              {!leadAuditLoading && !leadAuditError && leadAuditRows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border text-[10px] font-bold text-muted uppercase tracking-wider">
                        <th className="px-4 py-3">Lead / Fuente</th>
                        <th className="px-4 py-3">Campaña / Form</th>
                        <th className="px-4 py-3 text-center">Creado</th>
                        <th className="px-4 py-3">Tel. Lead</th>
                        <th className="px-4 py-3 text-center">Cruce</th>
                        <th className="px-4 py-3">Paciente / Tel.</th>
                        <th className="px-4 py-3">Settlement / Fecha</th>
                        <th className="px-4 py-3 text-center">Match tel.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {leadAuditRows.map((row) => (
                        <tr key={row.lead_id} className="group hover:bg-surface transition-colors">
                          <td className="px-4 py-4">
                            <p className="font-bold text-foreground text-sm">{row.lead_name ?? '—'}</p>
                            <p className="text-[10px] font-bold text-primary uppercase mt-1">{row.source ?? '—'}</p>
                          </td>
                          <td className="px-4 py-4 max-w-[200px]">
                            <p className="text-xs font-medium text-foreground truncate" title={row.campaign_name}>{row.campaign_name ?? '—'}</p>
                            <p className="text-[10px] text-muted font-medium mt-1 truncate" title={row.form_name}>{row.form_name ?? '—'}</p>
                          </td>
                          <td className="px-4 py-4 text-xs text-center font-medium text-muted">
                            {row.lead_created_at ? new Date(row.lead_created_at).toLocaleDateString('es-ES') : '—'}
                          </td>
                          <td className="px-4 py-4 text-xs font-bold text-foreground font-mono">
                            {row.phone_normalized ?? '—'}
                          </td>
                          <td className="px-4 py-4 text-center">
                            {row.match_class ? (
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20 w-fit">
                                  {row.match_class}
                                </span>
                                {row.match_confidence != null && (
                                  <p className="text-[10px] text-muted font-bold tracking-tighter">{Math.round(row.match_confidence * 100)}%</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted/10 text-muted border border-muted/20 w-fit">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            <p className="text-xs font-bold text-foreground">{row.patient_name ?? '—'}</p>
                            <p className="text-[10px] text-muted font-mono mt-1">{row.patient_phone ?? '—'}</p>
                          </td>
                          <td className="px-4 py-4">
                            <p className="text-xs font-bold text-primary">{row.settlement_date ? `€${row.doctoralia_net?.toLocaleString('es-ES') ?? '—'}` : '—'}</p>
                            <p className="text-[10px] text-muted font-medium mt-1">
                              {row.first_settlement_at ? new Date(row.first_settlement_at).toLocaleDateString('es-ES') : '—'}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-center">
                            {row.phoneCrossMatch ? (
                              <div className="bg-green-500/10 p-1.5 rounded-lg inline-block border border-green-500/20">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              </div>
                            ) : (
                              <div className="bg-muted/10 p-1.5 rounded-lg inline-block border border-muted/20">
                                <XCircle className="w-4 h-4 text-muted/40" />
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Doctoralia Financials ── */}
        <TabsContent value="doctoralia" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-surface/70 p-3">
            <FilterBar onDateChange={(from, to) => { setDocFrom(from); setDocTo(to) }} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Doctoralia Financials — by Template</CardTitle>
              {docData && (
                <ExportButton
                  data={docData.templateSummary}
                  filename="doctoralia-financials"
                  disabled={docLoading}
                />
              )}
            </CardHeader>
            <CardContent>
              {(() => {
                if (docError) return <ErrorState message={docError} />
                if (docLoading) return <EmptyState message="Loading…" />
                if ((docData?.templateSummary.length ?? 0) === 0)
                  return <EmptyState message="No settlement data available yet." />
                return (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Template', 'Ops', 'Net Revenue', 'Avg Ticket', 'Share %', 'Cancel %']} />
                    <tbody>
                      {docData?.templateSummary.map((r) => (
                        <TableRow
                          key={r.template_name}
                          cells={[
                            r.template_name,
                            r.operations_count,
                            curr(r.total_net),
                            curr(r.avg_ticket),
                            pct(r.revenue_share_pct),
                            pct(r.cancellation_rate_pct),
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                )
              })()}
            </CardContent>
          </Card>
          {/* Monthly detail table */}
          {!docLoading && (docData?.byMonth.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Monthly Detail</CardTitle>
                <ExportButton
                  data={docData.byMonth}
                  filename="doctoralia-by-month"
                  disabled={docLoading}
                />
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Month', 'Ops', 'Cancels', 'Gross', 'Net', 'Avg Ticket', 'Cancel %', 'Discount %']} />
                    <tbody>
                      {docData.byMonth.map((r) => (
                        <TableRow
                          key={r.settled_month}
                          cells={[
                            r.settled_month,
                            r.operations_count,
                            r.cancellation_count ?? '—',
                            curr(r.total_gross),
                            curr(r.total_net),
                            curr(r.avg_ticket_net),
                            pct(r.cancellation_rate_pct),
                            pct(r.discount_rate_pct),
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Campaign Performance ── */}
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-surface/70 p-3">
            <FilterBar onDateChange={(from, to) => { setCampFrom(from); setCampTo(to) }} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Campaign Performance</CardTitle>
              <ExportButton data={filteredCampaigns} filename="campaign-performance" disabled={campLoading} />
            </CardHeader>
            <CardContent>
              {(() => {
                if (campError) return <ErrorState message={campError} />
                if (campLoading) return <EmptyState message="Loading…" />
                if (filteredCampaigns.length === 0)
                  return <EmptyState message="No campaign data available yet." />
                return (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Campaign', 'Leads', 'Contacted', 'Replied', 'Booked', 'Closed', '% Cita', '% No-show', 'Rev. CRM', 'Reply delay (min)']} />
                    <tbody>
                      {filteredCampaigns.map((r) => (
                        <TableRow
                          key={r.campaign_name}
                          cells={[
                            r.campaign_name,
                            r.total_leads,
                            r.contacted,
                            r.replied,
                            r.booked,
                            r.closed,
                            pct(r.replied_to_booked_pct),
                            pct(r.no_show_rate_pct),
                            curr(r.verified_revenue_crm),
                            r.avg_reply_delay_min ?? '—',
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Source Comparison ── */}
        <TabsContent value="sources" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-surface/70 p-3">
            <FilterBar onDateChange={(from, to) => { setSrcFrom(from); setSrcTo(to) }} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Source Comparison</CardTitle>
              <ExportButton data={filteredSources} filename="source-comparison" disabled={srcLoading} />
            </CardHeader>
            <CardContent>
              {(() => {
                if (srcError) return <ErrorState message={srcError} />
                if (srcLoading) return <EmptyState message="Loading…" />
                if (filteredSources.length === 0)
                  return <EmptyState message="No source comparison data available yet." />
                return (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Source', 'Leads', 'Contacted', 'Reply %', 'Booking %', 'Close %', 'Avg Reply (min)', 'Verified Revenue']} />
                    <tbody>
                      {filteredSources.map((r) => (
                        <TableRow
                          key={r.source_label ?? r.source}
                          cells={[
                            r.source_label ?? r.source,
                            r.total_leads,
                            r.contacted,
                            pct(r.reply_rate_pct),
                            pct(r.replied_to_booked_pct),
                            pct(r.lead_to_close_rate_pct),
                            r.avg_reply_delay_min ?? '—',
                            curr(r.verified_revenue_crm),
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── WhatsApp Conversion ── */}
        <TabsContent value="whatsapp" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>WhatsApp Conversion Cohorts</CardTitle>
              <ExportButton data={cohorts} filename="whatsapp-conversion" disabled={waLoading} />
            </CardHeader>
            <CardContent>
              {(() => {
                if (waError) return <ErrorState message={waError} />
                if (waLoading) return <EmptyState message="Loading…" />
                if (cohorts.length === 0)
                  return <EmptyState message="No WhatsApp cohort data available yet." />
                return (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Cohort', 'Leads', 'Est. Revenue', 'Verified Revenue', 'Avg Reply (min)']} />
                    <tbody>
                      {cohorts.map((r) => {
                        const cohortKey = `${String(r.cohort)}-${String(r.lead_count)}`
                        return (
                          <TableRow
                            key={cohortKey}
                            cells={[
                              String(r.cohort).replaceAll('_', ' '),
                              r.lead_count,
                              curr(r.estimated_revenue),
                              curr(r.verified_revenue_crm),
                              r.avg_reply_delay_min ?? '—',
                            ]}
                          />
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Doctor Performance ── */}
        <TabsContent value="doctors" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Doctor Performance</CardTitle>
              <ExportButton data={doctors} filename="doctor-performance" disabled={docPerfLoading} />
            </CardHeader>
            <CardContent>
              {(() => {
                if (docPerfError) return <ErrorState message={docPerfError} />
                if (docPerfLoading) return <EmptyState message="Loading…" />
                if (doctors.length === 0)
                  return <EmptyState message="No doctor performance data available yet." />
                return (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Doctor', 'Specialty', 'Appointments', 'Attended', 'No-show', 'Attended %', 'No-show %', 'Verified Revenue']} />
                    <tbody>
                      {doctors.map((r) => {
                        const doctorKey = `${String(r.doctor_name)}-${String(r.specialty ?? 'unknown')}`
                        return (
                          <TableRow
                            key={doctorKey}
                            cells={[
                              r.doctor_name,
                              r.specialty ?? '—',
                              r.total_appointments,
                              r.attended_count,
                              r.no_show_count,
                              pct(r.attended_rate_pct),
                              pct(r.no_show_rate_pct),
                              curr(r.verified_revenue_crm),
                            ]}
                          />
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Campaign ROI ── */}
        <TabsContent value="campaign-roi" className="mt-4 space-y-4">
          <div className="rounded-2xl border border-border bg-surface/70 p-3">
            <FilterBar
              onDateChange={(from, to) => { setRoiFrom(from); setRoiTo(to) }}
              sources={roiSources}
              sourceValue={roiSource}
              onSourceChange={setRoiSource}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Campaign ROI</CardTitle>
            </CardHeader>
            <CardContent>
              {roiError && <ErrorState message={roiError} />}
              {!roiError && (
                <SortableTable
                  columns={roiColumns}
                  rows={roiRows}
                  loading={roiLoading}
                  exportFilename="campaign-roi"
                  emptyMessage="No campaign ROI data available yet."
                  pageSize={200}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
