import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { invokeApi } from '../lib/invokeApi'
import type { FunnelRow, CampaignPerformance as Campaign, Conversation, TraceabilityLead } from '../types'
import { FilterBar } from '../components/ui/FilterBar'
import { SortableTable } from '../components/ui/SortableTable'
import type { ColDef } from '../components/ui/SortableTable'
import { MetaAccountsInline } from '../components/MetaAccountsNotice'

function toLocalDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function daysAgoLocal(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return toLocalDateInputValue(date)
}

function getTraceabilityStage(row: TraceabilityLead) {
  if (row.patient_id || row.doc_patient_id || row.doctoralia_template_name) return 'Paciente cruzado'
  return 'Solo lead'
}

function getInsightKey(ins: Record<string, unknown>, idx: number) {
  return ins.id
    ? String(ins.id)
    : `${ins.agent_type ?? 'insight'}-${ins.created_at ?? ''}-${String(ins.output_text ?? ins.output_data ?? '').slice(0, 30)}-${idx}`
}

/**
 * Returns true when a parsed JSON object from output_text is substantively empty.
 * An insight with only an empty object {} must not render as a card — it is a
 * generation failure, not a valid insight.
 */
function isEmptyInsightPayload(parsed: unknown): boolean {
  if (parsed === null || parsed === undefined) return true
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const obj = parsed as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0) return true
  // An object with only metadata keys and no substantive content is still empty
  const METADATA_ONLY_KEYS = new Set(['date', 'generated_at', 'semantics', 'source', 'generator'])
  return keys.every((k) => METADATA_ONLY_KEYS.has(k))
}

function renderDailyInsightCard(ins: Record<string, unknown>, idx: number) {
  let content = String(ins.output_text ?? '')
  let parsed: unknown = null

  // Prefer the structured 'output' column over output_text when available
  if (ins.output && typeof ins.output === 'object') {
    parsed = ins.output
    content = ''
  } else if (content) {
    try {
      parsed = JSON.parse(content)
      content = ''
    } catch {
      // Not JSON — render as plain text below
    }
  }

  // ── Guard: empty payload ─────────────────────────────────────────────────
  if (isEmptyInsightPayload(parsed) && !content.trim()) {
    return (
      <div
        key={getInsightKey(ins, idx)}
        className="p-4 border border-[#E0A020]/30 rounded-lg bg-[#E0A020]/8"
      >
        <div className="flex justify-between text-xs text-muted mb-2">
          <span className="font-medium uppercase tracking-widest">
            {String(ins.agent_type ?? 'insight').replace('daily-', '').replace(/-/g, ' ')}
          </span>
          <span>{ins.created_at ? new Date(String(ins.created_at)).toLocaleDateString('es-ES') : ''}</span>
        </div>
        <p className="text-xs text-[#E0A020]">
          Insight vacío — el generador no produjo contenido para este período. El proceso
          diario lo regenerará en la próxima ejecución.
        </p>
        {ins.model_used && (
          <div className="text-[10px] text-muted mt-1">Agente: {String(ins.model_used)}</div>
        )}
      </div>
    )
  }

  const parsedObj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    ? parsed as Record<string, unknown>
    : null

  return (
    <div key={getInsightKey(ins, idx)} className="p-4 border rounded-lg bg-surface">
      <div className="flex justify-between text-xs text-muted mb-2">
        <span className="font-medium uppercase tracking-widest">
          {String(ins.agent_type ?? 'insight').replace('daily-', '').replace(/-/g, ' ')}
        </span>
        <span>
          {ins.created_at ? new Date(String(ins.created_at)).toLocaleDateString('es-ES') : ''}
        </span>
      </div>

      {parsedObj ? (
        <div className="space-y-2 text-sm">
          {/* Recommendations */}
          {Array.isArray(parsedObj.recommendations) && (parsedObj.recommendations as unknown[]).length > 0 && (
            <div>
              <div className="font-semibold text-xs uppercase text-primary mb-1">
                Recomendaciones accionables:
              </div>
              <ul className="list-disc pl-5">
                {(parsedObj.recommendations as unknown[]).map((rec, j) => (
                  <li key={`${getInsightKey(ins, idx)}-rec-${j}`}>{String(rec)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* AI Summary */}
          {parsedObj.ai_summary && (
            <div>
              <span className="font-semibold text-xs uppercase">Resumen IA:</span>{' '}
              {String(parsedObj.ai_summary)}
            </div>
          )}

          {/* Risk leads */}
          {parsedObj.risk_leads != null && (
            <div>
              Leads en riesgo (&gt;14 días sin avance):{' '}
              <span className="font-semibold">{String(parsedObj.risk_leads)}</span>
            </div>
          )}

          {/* Doctoralia operations */}
          {parsedObj.doctoralia_operations &&
            typeof parsedObj.doctoralia_operations === 'object' && (
              <div>
                {(() => {
                  const ops = parsedObj.doctoralia_operations as Record<string, unknown>
                  return (
                    <>
                      Doctoralia hoy:{' '}
                      <span className="font-semibold">{String(ops.appointments_today ?? 0)}</span> citas ·{' '}
                      <span className="font-semibold">{String(ops.realized_today ?? 0)}</span> realizadas ·{' '}
                      <span className="font-semibold">{String(ops.cancelled_today ?? 0)}</span> canceladas
                      {ops.amount_semantics && (
                        <span className="text-[10px] text-muted ml-2">
                          ({String(ops.amount_semantics)})
                        </span>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

          {/* Data freshness */}
          {parsedObj.data_freshness && typeof parsedObj.data_freshness === 'object' && (
            <div className="text-[10px] text-muted space-x-3">
              {(() => {
                const df = parsedObj.data_freshness as Record<string, unknown>
                return (
                  <>
                    {df.crm_latest_lead_at && (
                      <span>CRM: {new Date(String(df.crm_latest_lead_at)).toLocaleDateString('es-ES')}</span>
                    )}
                    {df.doctoralia_imported_at && (
                      <span>Doctoralia: {new Date(String(df.doctoralia_imported_at)).toLocaleDateString('es-ES')}</span>
                    )}
                    {df.meta_latest_date && (
                      <span>Meta: {String(df.meta_latest_date)}</span>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap">{content}</div>
      )}

      {ins.model_used && (
        <div className="text-[10px] text-muted mt-1">Agente: {String(ins.model_used)}</div>
      )}
    </div>
  )
}

function getDailyInsightsContent(dailyLoading: boolean, dailyInsights: Record<string, unknown>[]) {
  if (dailyLoading) return <p className="text-muted text-sm">Cargando insights del día...</p>

  if (dailyInsights.length === 0) {
    return (
      <p className="text-muted text-sm">
        Aún no hay insights diarios generados. El proceso diario los creará automáticamente a las
        07:50 (hora Madrid).
      </p>
    )
  }

  // Filter out structurally empty insights before rendering
  const substantive = dailyInsights.filter((ins) => {
    let parsed: unknown = ins.output ?? null
    if (!parsed && ins.output_text) {
      try {
        parsed = JSON.parse(String(ins.output_text))
      } catch {
        // plain text — not empty
        return String(ins.output_text ?? '').trim().length > 0
      }
    }
    return !isEmptyInsightPayload(parsed) || String(ins.output_text ?? '').trim().length > 0
  })

  const emptyCount = dailyInsights.length - substantive.length

  return (
    <div className="space-y-4">
      {emptyCount > 0 && (
        <div className="rounded-lg border border-[#E0A020]/30 bg-[#E0A020]/8 px-3 py-2 text-xs text-[#5C5550]">
          {emptyCount} insight{emptyCount > 1 ? 's' : ''} con payload vacío excluido
          {emptyCount > 1 ? 's' : ''} de la vista. El generador los actualizará en la próxima
          ejecución programada.
        </div>
      )}
      {dailyInsights.map((ins, idx) => renderDailyInsightCard(ins, idx))}
    </div>
  )
}

export default function Intelligence() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [traceability, setTraceability] = useState<TraceabilityLead[]>([])
  const [loading, setLoading] = useState({
    funnel: true,
    campaigns: true,
    conversations: true,
    traceability: true,
  })
  const [error, setError] = useState<{
    funnel?: string
    campaigns?: string
    conversations?: string
    traceability?: string
  }>({})
  const [dailyInsights, setDailyInsights] = useState<Record<string, unknown>[]>([])
  const [dailyLoading, setDailyLoading] = useState(true)

  const [traceFrom, setTraceFrom] = useState<string>(() => daysAgoLocal(90))
  const [traceTo, setTraceTo] = useState<string>(() => toLocalDateInputValue(new Date()))
  const [traceSource, setTraceSource] = useState<string>('')
  const [performanceFrom, setPerformanceFrom] = useState<string>(() => daysAgoLocal(90))
  const [performanceTo, setPerformanceTo] = useState<string>(() => toLocalDateInputValue(new Date()))
  const [performanceSource, setPerformanceSource] = useState<string>('')

  const traceSources = useMemo(
    () =>
      [
        ...new Set(
          traceability.map((lead) => String(lead.source ?? '')).filter(Boolean)
        ),
      ] as string[],
    [traceability]
  )
  const performanceSources = useMemo(
    () =>
      [
        ...new Set(
          campaigns.map((c) => String(c.source ?? '')).filter(Boolean)
        ),
      ] as string[],
    [campaigns]
  )

  const performanceColumns: ColDef[] = [
    { key: 'source', label: 'Fuente', align: 'left' },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    { key: 'total_leads', label: 'Leads', align: 'right', sortable: true },
    { key: 'contacted', label: 'Contactados', align: 'right', sortable: true },
    { key: 'replied', label: 'Respondieron', align: 'right', sortable: true },
    { key: 'booked', label: 'Agendados', align: 'right', sortable: true },
    { key: 'attended', label: 'Asistidos', align: 'right', sortable: true },
    { key: 'no_shows', label: 'No show', align: 'right', sortable: true },
    {
      key: 'reply_rate_pct',
      label: 'Respuesta %',
      align: 'right',
      sortable: true,
      format: (value) => (value == null ? null : `${value}%`),
    },
    {
      key: 'avg_reply_delay_min',
      label: 'Resp. min',
      align: 'right',
      sortable: true,
      format: (value) => (value == null ? null : String(value)),
    },
  ]

  const traceabilityRows = useMemo(
    () => traceability.map((row) => ({ ...row, _stage: getTraceabilityStage(row) })),
    [traceability]
  )
  const traceabilityColumns: ColDef[] = [
    { key: 'source', label: 'Fuente', align: 'left' },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    {
      key: 'lead_created_at',
      label: 'Lead creado',
      align: 'left',
      format: (value) => (value ? new Date(String(value)).toLocaleDateString('es-ES') : null),
    },
    { key: '_stage', label: 'Etapa', align: 'left' },
    { key: 'patient_name', label: 'Paciente', align: 'left' },
    { key: 'patient_dni', label: 'DNI', align: 'left' },
    { key: 'patient_phone', label: 'Teléfono', align: 'left' },
    { key: 'doctoralia_template_name', label: 'Registro Doctoralia', align: 'left' },
    {
      key: 'match_confidence',
      label: 'Confianza',
      align: 'right',
      format: (value) =>
        value == null ? null : `${(Number(value) * 100).toFixed(0)}%`,
    },
    {
      key: 'match_class',
      label: 'Cruce',
      align: 'left',
      format: (value) => (value ? String(value).replaceAll('_', ' ') : null),
    },
  ]

  useEffect(() => {
    invokeApi('/api/traceability/funnel')
      .then((data: unknown) => {
        const d = data as Record<string, unknown>
        setFunnel(Array.isArray(d?.funnel) ? (d.funnel as FunnelRow[]) : [])
        setLoading((previous) => ({ ...previous, funnel: false }))
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudo cargar el embudo.'
        setError((previous) => ({ ...previous, funnel: msg }))
        setLoading((previous) => ({ ...previous, funnel: false }))
      })

    invokeApi('/api/conversations')
      .then((data: unknown) => {
        const d = data as Record<string, unknown>
        setConversations(
          Array.isArray(d?.conversations) ? (d.conversations as Conversation[]).slice(0, 20) : []
        )
        setLoading((previous) => ({ ...previous, conversations: false }))
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudieron cargar las conversaciones.'
        setError((previous) => ({ ...previous, conversations: msg }))
        setLoading((previous) => ({ ...previous, conversations: false }))
      })
  }, [])

  useEffect(() => {
    const params: string[] = []
    if (performanceFrom) params.push(`from=${performanceFrom}`)
    if (performanceTo) params.push(`to=${performanceTo}`)
    if (performanceSource) params.push(`source=${encodeURIComponent(performanceSource)}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    invokeApi(`/api/traceability/campaigns${qs}`)
      .then((data: unknown) => {
        const d = data as Record<string, unknown>
        setCampaigns(Array.isArray(d?.campaigns) ? (d.campaigns as Campaign[]) : [])
        setLoading((previous) => ({ ...previous, campaigns: false }))
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudieron cargar las campañas.'
        setError((previous) => ({ ...previous, campaigns: msg }))
        setLoading((previous) => ({ ...previous, campaigns: false }))
      })
  }, [performanceFrom, performanceTo, performanceSource])

  useEffect(() => {
    const params: string[] = ['limit=500']
    if (traceFrom) params.push(`from=${traceFrom}`)
    if (traceTo) params.push(`to=${traceTo}`)
    if (traceSource) params.push(`source=${encodeURIComponent(traceSource)}`)
    invokeApi(`/api/traceability/leads?${params.join('&')}`)
      .then((data: unknown) => {
        const d = data as Record<string, unknown>
        setTraceability(Array.isArray(d?.leads) ? (d.leads as TraceabilityLead[]) : [])
        setLoading((previous) => ({ ...previous, traceability: false }))
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'No se pudo cargar la trazabilidad.'
        setError((previous) => ({ ...previous, traceability: msg }))
        setLoading((previous) => ({ ...previous, traceability: false }))
      })
  }, [traceFrom, traceTo, traceSource])

  useEffect(() => {
    let active = true
    const load = async () => {
      setDailyLoading(true)
      try {
        const data: unknown = await invokeApi('/api/ai/outputs?limit=20')
        if (!active) return
        const d = data as Record<string, unknown>
        const outputs = Array.isArray(d?.outputs) ? (d.outputs as Record<string, unknown>[]) : []
        const daily = outputs.filter(
          (output) =>
            typeof output.agent_type === 'string' &&
            (output.agent_type.includes('daily') || output.agent_type.includes('insight'))
        )
        setDailyInsights(daily)
      } catch {
        void 0
      } finally {
        if (active) setDailyLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  let performanceContent
  if (loading.campaigns) performanceContent = <p className="text-muted text-sm">Cargando rendimiento de campañas…</p>
  else if (error.campaigns) performanceContent = <p className="text-sm text-[#D9534F]">{error.campaigns}</p>
  else performanceContent = (
    <SortableTable
      columns={performanceColumns}
      rows={campaigns as unknown as Record<string, unknown>[]}
      exportFilename="rendimiento-campanas"
      pageSize={200}
      emptyMessage="No hay rendimiento de campañas para el período seleccionado."
    />
  )

  let funnelContent
  if (loading.funnel) funnelContent = <p className="text-muted text-sm">Cargando datos del embudo…</p>
  else if (error.funnel) funnelContent = <p className="text-sm text-[#D9534F]">{error.funnel}</p>
  else if (funnel.length === 0) funnelContent = (
    <div className="space-y-2">
      <p className="text-muted text-sm">No hay datos del embudo disponibles todavía.</p>
      <p className="text-xs text-muted">
        El embudo WhatsApp requiere conversaciones persistidas en <code>whatsapp_conversations</code>.
        Actualmente hay 0 registros — la columna refleja el estado real de la ingestión.
      </p>
    </div>
  )
  else funnelContent = (
    <div className="space-y-2">
      {funnel.map((row) => (
        <div
          key={row.stage}
          className="flex justify-between items-center p-3 rounded-lg bg-surface border border-border"
        >
          <span className="capitalize text-sm text-[#d7c5ae]">
            {String(row.stage).replaceAll('_', ' ')}
          </span>
          <span className="font-bold text-sm">
            {(row.count ?? 0).toLocaleString()}
            {row.pct != null ? ` (${row.pct}%)` : ''}
          </span>
        </div>
      ))}
    </div>
  )

  let conversationsContent
  if (loading.conversations) conversationsContent = <p className="text-muted text-sm">Cargando conversaciones…</p>
  else if (error.conversations) conversationsContent = <p className="text-sm text-[#D9534F]">{error.conversations}</p>
  else if (conversations.length === 0) conversationsContent = (
    <div className="space-y-1">
      <p className="text-muted text-sm">No se encontraron conversaciones.</p>
      <p className="text-xs text-muted">
        0 registros en <code>whatsapp_conversations</code> y{' '}
        <code>whatsapp_send_requests</code>. El funnel Meta → WhatsApp → Cita no puede
        trazarse hasta que la ingestión de conversaciones esté activa.
      </p>
    </div>
  )
  else conversationsContent = (
    <div className="space-y-3">
      {conversations.map((conversation) => (
        <div key={conversation.id} className="p-3 bg-surface rounded-lg border border-border">
          <div className="flex justify-between">
            <p className="text-sm font-medium">{conversation.phone ?? conversation.id}</p>
            <span className="text-xs text-muted capitalize">{conversation.direction}</span>
          </div>
          {conversation.message_preview && (
            <p className="text-xs text-muted mt-1 truncate">{conversation.message_preview}</p>
          )}
          {conversation.sent_at && (
            <p className="text-xs text-muted mt-1">
              {new Date(conversation.sent_at).toLocaleString('es-ES')}
            </p>
          )}
        </div>
      ))}
    </div>
  )

  let traceabilityContent
  if (loading.traceability) traceabilityContent = <p className="text-muted text-sm">Cargando trazabilidad…</p>
  else if (error.traceability) traceabilityContent = <p className="text-sm text-[#D9534F]">{error.traceability}</p>
  else if (traceability.length === 0) traceabilityContent = (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <p className="text-[#d7c5ae] font-medium">No hay datos de trazabilidad todavía</p>
      <p className="text-muted text-sm max-w-md">
        Cuando el sistema cruce Doctoralia por DNI, nombre o teléfono, cada lead se vinculará
        al registro de paciente correspondiente.
      </p>
    </div>
  )
  else traceabilityContent = (
    <SortableTable
      columns={traceabilityColumns}
      rows={traceabilityRows as unknown as Record<string, unknown>[]}
      exportFilename="trazabilidad-leads"
      pageSize={200}
      emptyMessage="No hay datos de trazabilidad todavía."
    />
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Inteligencia</h1>
        <p className="text-muted mt-1">
          Rendimiento operativo de campañas, embudo WhatsApp, conversaciones y trazabilidad
        </p>
        <MetaAccountsInline
          context="Inteligencia de campañas, conversaciones y trazabilidad asociada a estas cuentas Meta."
          className="mt-4 max-w-2xl"
        />
      </div>

      <Tabs defaultValue="performance" className="w-full">
        <TabsList>
          <TabsTrigger value="performance">Rendimiento</TabsTrigger>
          <TabsTrigger value="funnel">Embudo WhatsApp</TabsTrigger>
          <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
          <TabsTrigger value="traceability">Trazabilidad</TabsTrigger>
          <TabsTrigger value="daily-insights">Insights diarios</TabsTrigger>
        </TabsList>

        <TabsContent value="performance">
          <Card>
            <CardHeader>
              <CardTitle>Rendimiento operativo de campañas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterBar
                onDateChange={(from, to) => {
                  setPerformanceFrom(from)
                  setPerformanceTo(to)
                }}
                sources={performanceSources}
                sourceValue={performanceSource}
                onSourceChange={setPerformanceSource}
              />
              {performanceContent}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>Embudo de conversión WhatsApp</CardTitle>
              <p className="text-xs text-muted">
                Requiere conversaciones persistidas en <code>whatsapp_conversations</code>.
                Estado actual: 0 registros.
              </p>
            </CardHeader>
            <CardContent>{funnelContent}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Conversaciones recientes</CardTitle>
            </CardHeader>
            <CardContent>{conversationsContent}</CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="traceability">
          <Card>
            <CardHeader>
              <CardTitle>Lead → paciente</CardTitle>
              <p className="text-xs text-muted">
                Sin métricas de caja hasta disponer de una fuente de cobros reconciliada.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterBar
                onDateChange={(from, to) => {
                  setTraceFrom(from)
                  setTraceTo(to)
                }}
                sources={traceSources}
                sourceValue={traceSource}
                onSourceChange={setTraceSource}
              />
              {traceabilityContent}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="daily-insights">
          <Card>
            <CardHeader>
              <CardTitle>Insights diarios de agentes</CardTitle>
              <p className="text-xs text-muted">
                Generados automáticamente sobre datos operativos persistidos. Objetos vacíos{' '}
                <code>{'{}'}</code> se excluyen de la vista.
              </p>
            </CardHeader>
            <CardContent>{getDailyInsightsContent(dailyLoading, dailyInsights)}</CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
