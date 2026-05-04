import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { invokeApi } from '../lib/supabaseClient'
import type { FunnelRow, CampaignPerformance as Campaign, Conversation, TraceabilityLead } from '../types'
import { FilterBar } from '../components/ui/FilterBar'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'

export default function Intelligence() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [traceability, setTraceability] = useState<TraceabilityLead[]>([])
  const [loading, setLoading] = useState({ funnel: true, campaigns: true, conversations: true, traceability: true })
  const [error, setError] = useState<{ funnel?: string; campaigns?: string; conversations?: string; traceability?: string }>({})

  // Traceability filter state
  const [traceFrom, setTraceFrom] = useState<string>(
    () => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  )
  const [traceTo, setTraceTo] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  )
  const [traceSource, setTraceSource] = useState<string>('')

  const traceSources = useMemo(
    () => [...new Set(traceability.map((l: any) => l.source).filter(Boolean))] as string[],
    [traceability],
  )

  const traceabilityRows = useMemo(
    () => traceability.map((row: TraceabilityLead) => ({
      ...row,
      _stage: (row as any).doctoralia_net != null ? 'Revenue' : (row as any).patient_id ? 'Patient' : 'Lead only',
    })),
    [traceability],
  )

  const traceabilityColumns: ColDef[] = [
    { key: 'source', label: 'Fuente', align: 'left' },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    { key: 'lead_created_at', label: 'Lead creado', align: 'left',
      format: (v) => v ? new Date(v).toLocaleDateString('es-MX') : null },
    { key: '_stage', label: 'Etapa', align: 'left' },
    { key: 'patient_name', label: 'Paciente', align: 'left' },
    { key: 'patient_dni', label: 'DNI', align: 'left' },
    { key: 'patient_phone', label: 'Teléfono', align: 'left' },
    { key: 'patient_ltv', label: 'LTV', align: 'right',
      format: (v) => v != null ? Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) : null },
    { key: 'first_settlement_at', label: '1ª liquidación', align: 'left',
      format: (v) => v ? new Date(v).toLocaleDateString('es-MX') : null },
    { key: 'settlement_date', label: 'Últ. liquidación', align: 'left',
      format: (v) => v ? new Date(v).toLocaleDateString('es-MX') : null },
    { key: 'match_confidence', label: 'Confianza', align: 'right',
      format: (v) => v != null ? `${(Number(v) * 100).toFixed(0)}%` : null },
    { key: 'match_class', label: 'Match', align: 'left',
      format: (v) => v ? String(v).replace(/_/g, ' ') : null },
  ]

  useEffect(() => {
    invokeApi('/traceability/funnel')
      .then((data: any) => {
        setFunnel(Array.isArray(data?.funnel) ? data.funnel : [])
        setLoading((prev) => ({ ...prev, funnel: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, funnel: err?.message || 'Failed to load funnel.' }))
        setLoading((prev) => ({ ...prev, funnel: false }))
      })

    invokeApi('/traceability/campaigns')
      .then((data: any) => {
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : [])
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, campaigns: err?.message || 'Failed to load campaigns.' }))
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })

    invokeApi('/conversations')
      .then((data: any) => {
        setConversations(Array.isArray(data?.conversations) ? data.conversations.slice(0, 20) : [])
        setLoading((prev) => ({ ...prev, conversations: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, conversations: err?.message || 'Failed to load conversations.' }))
        setLoading((prev) => ({ ...prev, conversations: false }))
      })
  }, [])

  // Separate effect for traceability so filters trigger re-fetch
  useEffect(() => {
    const params: string[] = [`limit=500`]
    if (traceFrom) params.push(`from=${traceFrom}`)
    if (traceTo) params.push(`to=${traceTo}`)
    if (traceSource) params.push(`source=${encodeURIComponent(traceSource)}`)
    invokeApi(`/traceability/leads?${params.join('&')}`)
      .then((data: any) => {
        setTraceability(Array.isArray(data?.leads) ? data.leads : [])
        setLoading((prev) => ({ ...prev, traceability: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, traceability: err?.message || 'Failed to load traceability.' }))
        setLoading((prev) => ({ ...prev, traceability: false }))
      })
  }, [traceFrom, traceTo, traceSource])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Intelligence</h1>
        <p className="text-slate-400 mt-1">Campaign attribution, WhatsApp funnel, conversation log</p>
      </div>

      <Tabs defaultValue="attribution" className="w-full">
        <TabsList>
          <TabsTrigger value="attribution">Attribution</TabsTrigger>
          <TabsTrigger value="funnel">WhatsApp Funnel</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="traceability">Traceability</TabsTrigger>
        </TabsList>

        <TabsContent value="attribution">
          <Card>
            <CardHeader>
              <CardTitle>Multi-Touch Attribution</CardTitle>
            </CardHeader>
            <CardContent>
              {loading.campaigns ? (
                <p className="text-slate-500 text-sm">Loading attribution data…</p>
              ) : error.campaigns ? (
                <p className="text-sm text-red-500">{error.campaigns}</p>
              ) : campaigns.length === 0 ? (
                <p className="text-slate-500 text-sm">No attribution data available yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="text-left text-xs font-semibold text-slate-400 px-3 py-2">Source / Campaign</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Leads</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Contacted</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Replied</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Booked</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Won</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Reply %</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Close %</th>
                        <th className="text-right text-xs font-semibold text-slate-400 px-3 py-2">Reply lag (min)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns.map((c, i) => (
                        <tr key={i} className="border-b border-slate-800 hover:bg-slate-800/50">
                          <td className="px-3 py-2 text-sm text-slate-300">
                            {c.source}{c.campaign_name ? ` — ${c.campaign_name}` : ''}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">{c.total_leads}</td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">{c.contacted ?? '—'}</td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">{c.replied ?? '—'}</td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">{c.booked ?? '—'}</td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">{c.closed_won ?? '—'}</td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">
                            {c.reply_rate_pct != null ? `${c.reply_rate_pct}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">
                            {c.lead_to_close_rate_pct != null ? `${c.lead_to_close_rate_pct}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-sm text-slate-300 text-right">{c.avg_reply_delay_min ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {loading.funnel ? (
                <p className="text-slate-500 text-sm">Loading funnel data…</p>
              ) : error.funnel ? (
                <p className="text-sm text-red-500">{error.funnel}</p>
              ) : funnel.length === 0 ? (
                <p className="text-slate-500 text-sm">No funnel data available yet.</p>
              ) : (
                <div className="space-y-2">
                  {funnel.map((row, i) => (
                    <div key={i} className="flex justify-between items-center p-3 rounded-lg bg-slate-900 border border-slate-700">
                      <span className="capitalize text-sm text-slate-300">{String(row.stage).replace(/_/g, ' ')}</span>
                      <span className="font-bold text-sm">
                        {row.count.toLocaleString()}
                        {row.pct != null ? ` (${row.pct}%)` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Recent Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              {loading.conversations ? (
                <p className="text-slate-500 text-sm">Loading conversations…</p>
              ) : error.conversations ? (
                <p className="text-sm text-red-500">{error.conversations}</p>
              ) : conversations.length === 0 ? (
                <p className="text-slate-500 text-sm">No conversations found.</p>
              ) : (
                <div className="space-y-3">
                  {conversations.map((conv) => (
                    <div key={conv.id} className="p-3 bg-slate-900 rounded-lg border border-slate-700">
                      <div className="flex justify-between">
                        <p className="text-sm font-medium">{conv.phone ?? conv.id}</p>
                        <span className="text-xs text-slate-500 capitalize">{conv.direction}</span>
                      </div>
                      {conv.message_preview && (
                        <p className="text-xs text-slate-400 mt-1 truncate">{conv.message_preview}</p>
                      )}
                      {conv.sent_at && (
                        <p className="text-xs text-slate-500 mt-1">{new Date(conv.sent_at).toLocaleString()}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="traceability">
          <Card>
            <CardHeader>
              <CardTitle>Lead → Patient → Revenue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filter bar */}
              <FilterBar
                onDateChange={(from, to) => { setTraceFrom(from); setTraceTo(to) }}
                sources={traceSources}
                sourceValue={traceSource}
                onSourceChange={setTraceSource}
              />
              {loading.traceability ? (
                <p className="text-slate-500 text-sm">Cargando trazabilidad…</p>
              ) : error.traceability ? (
                <p className="text-sm text-red-500">{error.traceability}</p>
              ) : traceability.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <p className="text-slate-300 font-medium">No hay datos de trazabilidad todavía</p>
                  <p className="text-slate-500 text-sm max-w-md">
                    Cuando el sistema ejecute el matching de Doctoralia (por DNI o nombre/teléfono),
                    cada lead se vinculará a su paciente y a su historial de liquidaciones.
                    Los datos aparecerán aquí automáticamente.
                  </p>
                </div>
              ) : (
                <SortableTable
                  columns={traceabilityColumns}
                  rows={traceabilityRows}
                  exportFilename="traceability-leads"
                  pageSize={200}
                  emptyMessage="No hay datos de trazabilidad todavía."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
