import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AlertCircle, FileBarChart2, TrendingUp, Users, MessageCircle, Stethoscope, BarChart3 } from 'lucide-react'
import { invokeApi } from '../lib/supabaseClient'
import { ExportButton } from '../components/reports/ExportButton'
import { FilterBar } from '../components/ui/FilterBar'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'

function EmptyState({ message }: { message: string }) {
  return <p className="text-slate-500 text-sm py-8 text-center">{message}</p>
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="p-4 bg-red-950 border border-red-800 rounded-lg flex gap-3">
      <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <p className="text-sm text-red-300">{message}</p>
    </div>
  )
}

function TableHead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-700">
        {cols.map((c) => (
          <th key={c} className="text-left text-xs font-semibold text-slate-400 px-3 py-2 whitespace-nowrap">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function TableRow({ cells }: { cells: (string | number | null | undefined)[] }) {
  return (
    <tr className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
      {cells.map((c, i) => (
        <td key={i} className="px-3 py-2 text-sm text-slate-300 whitespace-nowrap">
          {c ?? '—'}
        </td>
      ))}
    </tr>
  )
}

function pct(n: number | null | undefined) {
  return n != null ? `${n}%` : '—'
}
function curr(n: number | null | undefined) {
  return n != null
    ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
    : '—'
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
    invokeApi('/reports/campaign-performance')
      .then((d: any) => setCampaigns(d?.campaigns ?? []))
      .catch((e: any) => setCampError(e?.message || 'Failed to load campaign performance.'))
      .finally(() => setCampLoading(false))

    invokeApi('/reports/source-comparison')
      .then((d: any) => setSources(d?.sources ?? []))
      .catch((e: any) => setSrcError(e?.message || 'Failed to load source comparison.'))
      .finally(() => setSrcLoading(false))

    invokeApi('/reports/whatsapp-conversion')
      .then((d: any) => setCohorts(d?.cohorts ?? []))
      .catch((e: any) => setWaError(e?.message || 'Failed to load WhatsApp conversion.'))
      .finally(() => setWaLoading(false))

    invokeApi('/reports/doctor-performance')
      .then((d: any) => setDoctors(d?.doctors ?? []))
      .catch((e: any) => setDocPerfError(e?.message || 'Failed to load doctor performance.'))
      .finally(() => setDocPerfLoading(false))
  }, [])

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
      format: (v) => v != null ? Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }) : null },
    { key: 'spend', label: 'Spend Meta', align: 'right', sortable: true,
      format: (v) => v != null ? Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }) : null },
    { key: 'cac', label: 'CAC', align: 'right', sortable: true,
      format: (v) => v != null ? Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0 }) : null },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reports</h1>
        <p className="text-slate-400 mt-1">Doctoralia financials, campaign attribution, source comparison, WhatsApp funnel, doctor performance</p>
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
          <FilterBar onDateChange={(from, to) => { setDocFrom(from); setDocTo(to) }} />
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
              {docError && <ErrorState message={docError} />}
              {docLoading && !docError && <EmptyState message="Loading…" />}
              {!docLoading && !docError && (docData?.templateSummary.length ?? 0) === 0 && (
                <EmptyState message="No settlement data available yet." />
              )}
              {!docLoading && !docError && (docData?.templateSummary.length ?? 0) > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Template', 'Ops', 'Net Revenue', 'Avg Ticket', 'Share %', 'Cancel %']} />
                    <tbody>
                      {docData!.templateSummary.map((r, i) => (
                        <TableRow
                          key={i}
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
              )}
            </CardContent>
          </Card>
          {/* Monthly detail table */}
          {!docLoading && (docData?.byMonth.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>Monthly Detail</CardTitle>
                <ExportButton
                  data={docData!.byMonth}
                  filename="doctoralia-by-month"
                  disabled={docLoading}
                />
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Month', 'Ops', 'Cancels', 'Gross', 'Net', 'Avg Ticket', 'Cancel %', 'Discount %']} />
                    <tbody>
                      {docData!.byMonth.map((r, i) => (
                        <TableRow
                          key={i}
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
          <FilterBar onDateChange={(from, to) => { setCampFrom(from); setCampTo(to) }} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Campaign Performance</CardTitle>
              <ExportButton data={filteredCampaigns} filename="campaign-performance" disabled={campLoading} />
            </CardHeader>
            <CardContent>
              {campError && <ErrorState message={campError} />}
              {campLoading && !campError && <EmptyState message="Loading…" />}
              {!campLoading && !campError && filteredCampaigns.length === 0 && (
                <EmptyState message="No campaign data available yet." />
              )}
              {!campLoading && !campError && filteredCampaigns.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Campaign', 'Leads', 'Contacted', 'Replied', 'Booked', 'Closed', 'Close %', 'Reply delay (min)']} />
                    <tbody>
                      {filteredCampaigns.map((r, i) => (
                        <TableRow
                          key={i}
                          cells={[
                            r.campaign_name,
                            r.total_leads,
                            r.contacted,
                            r.replied,
                            r.booked,
                            r.closed,
                            pct(r.lead_to_close_rate_pct),
                            r.avg_reply_delay_min ?? '—',
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Source Comparison ── */}
        <TabsContent value="sources" className="mt-4 space-y-4">
          <FilterBar onDateChange={(from, to) => { setSrcFrom(from); setSrcTo(to) }} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Source Comparison</CardTitle>
              <ExportButton data={filteredSources} filename="source-comparison" disabled={srcLoading} />
            </CardHeader>
            <CardContent>
              {srcError && <ErrorState message={srcError} />}
              {srcLoading && !srcError && <EmptyState message="Loading…" />}
              {!srcLoading && !srcError && filteredSources.length === 0 && (
                <EmptyState message="No source comparison data available yet." />
              )}
              {!srcLoading && !srcError && filteredSources.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Source', 'Leads', 'Reply %', 'Booking %', 'Close %', 'Avg Reply (min)', 'Verified Revenue']} />
                    <tbody>
                      {filteredSources.map((r, i) => (
                        <TableRow
                          key={i}
                          cells={[
                            r.source_label ?? r.source,
                            r.total_leads,
                            pct(r.reply_rate_pct),
                            pct(r.booking_rate_pct),
                            pct(r.close_rate_pct),
                            r.avg_reply_delay_min ?? '—',
                            curr(r.verified_revenue),
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
              {waError && <ErrorState message={waError} />}
              {waLoading && !waError && <EmptyState message="Loading…" />}
              {!waLoading && !waError && cohorts.length === 0 && (
                <EmptyState message="No WhatsApp cohort data available yet." />
              )}
              {!waLoading && !waError && cohorts.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Cohort', 'Leads', 'Est. Revenue', 'Verified Revenue', 'Avg Reply (min)']} />
                    <tbody>
                      {cohorts.map((r, i) => (
                        <TableRow
                          key={i}
                          cells={[
                            String(r.cohort).replace(/_/g, ' '),
                            r.lead_count,
                            curr(r.estimated_revenue),
                            curr(r.verified_revenue_crm),
                            r.avg_reply_delay_min ?? '—',
                          ]}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
              {docPerfError && <ErrorState message={docPerfError} />}
              {docPerfLoading && !docPerfError && <EmptyState message="Loading…" />}
              {!docPerfLoading && !docPerfError && doctors.length === 0 && (
                <EmptyState message="No doctor performance data available yet." />
              )}
              {!docPerfLoading && !docPerfError && doctors.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <TableHead cols={['Doctor', 'Specialty', 'Appointments', 'Attended', 'No-show', 'Attended %', 'No-show %', 'Verified Revenue']} />
                    <tbody>
                      {doctors.map((r, i) => (
                        <TableRow
                          key={i}
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Campaign ROI ── */}
        <TabsContent value="campaign-roi" className="mt-4 space-y-4">
          <FilterBar
            onDateChange={(from, to) => { setRoiFrom(from); setRoiTo(to) }}
            sources={roiSources}
            sourceValue={roiSource}
            onSourceChange={setRoiSource}
          />
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
