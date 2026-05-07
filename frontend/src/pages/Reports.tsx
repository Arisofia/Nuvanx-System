import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AlertCircle, FileBarChart2, TrendingUp, Users, MessageCircle, Stethoscope, BarChart3 } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import { ExportButton } from '../components/reports/ExportButton'
import { FilterBar } from '../components/ui/FilterBar'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'

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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Reports</h1>
        <p className="text-muted mt-1">Doctoralia financials, campaign attribution, source comparison, WhatsApp funnel, doctor performance</p>
      </div>

      <Tabs defaultValue="doctoralia" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="doctoralia" className="gap-2"><FileBarChart2 className="w-4 h-4" />Doctoralia</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-2"><TrendingUp className="w-4 h-4" />Campaigns</TabsTrigger>
          <TabsTrigger value="sources" className="gap-2"><Users className="w-4 h-4" />Sources</TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2"><MessageCircle className="w-4 h-4" />WhatsApp</TabsTrigger>
          <TabsTrigger value="doctors" className="gap-2"><Stethoscope className="w-4 h-4" />Doctors</TabsTrigger>
          <TabsTrigger value="campaign-roi" className="gap-2"><BarChart3 className="w-4 h-4" />Campaign ROI</TabsTrigger>
        </TabsList>

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
