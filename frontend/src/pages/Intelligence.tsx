import { useEffect, useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { invokeApi } from '../lib/supabaseClient'
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
  if ((row as any).doctoralia_net != null) return 'Con caja'
  if ((row as any).patient_id) return 'Paciente cruzado'
  return 'Solo lead'
}

function getInsightKey(ins: any, idx: number) {
  return ins.id
    ? String(ins.id)
    : `${ins.agent_type ?? 'insight'}-${ins.created_at ?? ''}-${String(ins.output_text ?? ins.output_data ?? '').slice(0, 30)}-${idx}`
}

function renderDailyInsightCard(ins: any, idx: number) {
  let content = ins.output_text || ''
  let parsed: any = null

  try {
    parsed = JSON.parse(content)
    content = ''
  } catch {
    // ignore invalid JSON from agent output
  }

  return (
    <div key={getInsightKey(ins, idx)} className="p-4 border rounded-lg bg-surface">
      <div className="flex justify-between text-xs text-muted mb-2">
        <span className="font-medium uppercase tracking-widest">
          {ins.agent_type?.replace('daily-', '').replace('-', ' ')}
        </span>
        <span>{ins.created_at ? new Date(ins.created_at).toLocaleDateString('es-ES') : ''}</span>
      </div>
      {parsed && typeof parsed === 'object' ? (
        <div className="space-y-2 text-sm">
          {parsed.recommendations && Array.isArray(parsed.recommendations) && (
            <div>
              <div className="font-semibold text-xs uppercase text-primary mb-1">Recomendaciones accionables:</div>
              <ul className="list-disc pl-5">
                {parsed.recommendations.map((r: string, j: number) => <li key={`${getInsightKey(ins, idx)}-rec-${j}`}>{r}</li>)}
              </ul>
            </div>
          )}
          {parsed.ai_summary && <div><span className="font-semibold text-xs uppercase">Resumen IA:</span> {parsed.ai_summary}</div>}
          {parsed.risk_leads != null && <div>Riesgo leads: {parsed.risk_leads}</div>}
          {parsed.doctoralia_summary && <div>Doctoralia: €{parsed.doctoralia_summary.total_revenue} ({parsed.doctoralia_summary.total_patients} pacientes)</div>}
        </div>
      ) : (
        <div className="text-sm whitespace-pre-wrap">{content || JSON.stringify(ins.output_data || {})}</div>
      )}
      {ins.model_used && <div className="text-[10px] text-muted mt-1">Agente: {ins.model_used}</div>}
    </div>
  )
}

function getDailyInsightsContent(dailyLoading: boolean, dailyInsights: any[]) {
  if (dailyLoading) return <p className="text-muted text-sm">Cargando insights del día...</p>

  if (dailyInsights.length === 0) {
    return <p className="text-muted text-sm">Aún no hay insights diarios generados. El proceso diario los creará automáticamente.</p>
  }

  return <div className="space-y-4">{dailyInsights.map((ins, idx) => renderDailyInsightCard(ins, idx))}</div>
}

export default function Intelligence() {
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [traceability, setTraceability] = useState<TraceabilityLead[]>([])
  const [loading, setLoading] = useState({ funnel: true, campaigns: true, conversations: true, traceability: true })
  const [error, setError] = useState<{ funnel?: string; campaigns?: string; conversations?: string; traceability?: string }>({})
  const [dailyInsights, setDailyInsights] = useState<any[]>([])
  const [dailyLoading, setDailyLoading] = useState(true)

  const [traceFrom, setTraceFrom] = useState<string>(() => daysAgoLocal(90))
  const [traceTo, setTraceTo] = useState<string>(() => toLocalDateInputValue(new Date()))
  const [traceSource, setTraceSource] = useState<string>('')

  const [performanceFrom, setPerformanceFrom] = useState<string>(() => daysAgoLocal(90))
  const [performanceTo, setPerformanceTo] = useState<string>(() => toLocalDateInputValue(new Date()))
  const [performanceSource, setPerformanceSource] = useState<string>('')

  const traceSources = useMemo(
    () => [...new Set(traceability.map((l: any) => l.source).filter(Boolean))] as string[],
    [traceability],
  )

  const performanceSources = useMemo(
    () => [...new Set(campaigns.map((c: any) => c.source).filter(Boolean))] as string[],
    [campaigns],
  )

  const performanceColumns: ColDef[] = [
    { key: 'source', label: 'Fuente', align: 'left' },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    { key: 'total_leads', label: 'Leads', align: 'right', sortable: true },
    { key: 'contacted', label: 'Contactados', align: 'right', sortable: true },
    { key: 'replied', label: 'Respondieron', align: 'right', sortable: true },
    { key: 'booked', label: 'Agendados', align: 'right', sortable: true },
    { key: 'closed_won', label: 'Cerrados', align: 'right', sortable: true },
    { key: 'reply_rate_pct', label: 'Respuesta %', align: 'right', sortable: true, format: (v) => v === null || v === undefined ? null : `${v}%` },
    { key: 'lead_to_close_rate_pct', label: 'Cierre %', align: 'right', sortable: true, format: (v) => v === null || v === undefined ? null : `${v}%` },
    { key: 'verified_revenue_crm', label: 'Caja', align: 'right', sortable: true, format: (v) => v === null || v === undefined ? null : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
    { key: 'avg_reply_delay_min', label: 'Resp. min', align: 'right', sortable: true, format: (v) => v === null || v === undefined ? null : String(v) },
  ]

  const traceabilityRows = useMemo(
    () => traceability.map((row: TraceabilityLead) => ({ ...row, _stage: getTraceabilityStage(row) })),
    [traceability],
  )

  const traceabilityColumns: ColDef[] = [
    { key: 'source', label: 'Fuente', align: 'left' },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    { key: 'lead_created_at', label: 'Lead creado', align: 'left', format: (v) => v ? new Date(v).toLocaleDateString('es-ES') : null },
    { key: '_stage', label: 'Etapa', align: 'left' },
    { key: 'patient_name', label: 'Paciente', align: 'left' },
    { key: 'patient_dni', label: 'DNI', align: 'left' },
    { key: 'patient_phone', label: 'Teléfono', align: 'left' },
    { key: 'patient_ltv', label: 'LTV', align: 'right', format: (v) => v === null || v === undefined ? null : Number(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
    { key: 'first_settlement_at', label: '1ª liquidación', align: 'left', format: (v) => v ? new Date(v).toLocaleDateString('es-ES') : null },
    { key: 'settlement_date', label: 'Últ. liquidación', align: 'left', format: (v) => v ? new Date(v).toLocaleDateString('es-ES') : null },
    { key: 'match_confidence', label: 'Confianza', align: 'right', format: (v) => v === null || v === undefined ? null : `${(Number(v) * 100).toFixed(0)}%` },
    { key: 'match_class', label: 'Cruce', align: 'left', format: (v) => v ? String(v).replaceAll('_', ' ') : null },
  ]

  useEffect(() => {
    invokeApi('/api/traceability/funnel')
      .then((data: any) => {
        setFunnel(Array.isArray(data?.funnel) ? data.funnel : [])
        setLoading((prev) => ({ ...prev, funnel: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, funnel: err?.message || 'No se pudo cargar el embudo.' }))
        setLoading((prev) => ({ ...prev, funnel: false }))
      })

    invokeApi('/api/conversations')
      .then((data: any) => {
        setConversations(Array.isArray(data?.conversations) ? data.conversations.slice(0, 20) : [])
        setLoading((prev) => ({ ...prev, conversations: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, conversations: err?.message || 'No se pudieron cargar las conversaciones.' }))
        setLoading((prev) => ({ ...prev, conversations: false }))
      })
  }, [])

  useEffect(() => {
    const params: string[] = []
    if (performanceFrom) params.push(`from=${performanceFrom}`)
    if (performanceTo) params.push(`to=${performanceTo}`)
    if (performanceSource) params.push(`source=${encodeURIComponent(performanceSource)}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    invokeApi(`/api/traceability/campaigns${qs}`)
      .then((data: any) => {
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : [])
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, campaigns: err?.message || 'No se pudieron cargar las campañas.' }))
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })
  }, [performanceFrom, performanceTo, performanceSource])

  useEffect(() => {
    const params: string[] = ['limit=500']
    if (traceFrom) params.push(`from=${traceFrom}`)
    if (traceTo) params.push(`to=${traceTo}`)
    if (traceSource) params.push(`source=${encodeURIComponent(traceSource)}`)
    invokeApi(`/api/traceability/leads?${params.join('&')}`)
      .then((data: any) => {
        setTraceability(Array.isArray(data?.leads) ? data.leads : [])
        setLoading((prev) => ({ ...prev, traceability: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, traceability: err?.message || 'No se pudo cargar la trazabilidad.' }))
        setLoading((prev) => ({ ...prev, traceability: false }))
      })
  }, [traceFrom, traceTo, traceSource])

  useEffect(() => {
    let active = true
    const load = async () => {
      setDailyLoading(true)
      try {
        const data: any = await invokeApi('/api/ai/outputs?limit=20')
        if (!active) return
        const daily = (data?.outputs || []).filter((o: any) => o.agent_type && (o.agent_type.includes('daily') || o.agent_type.includes('insight')))
        setDailyInsights(daily)
      } catch {
        void 0
      } finally {
        if (active) setDailyLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  let performanceContent
  if (loading.campaigns) {
    performanceContent = <p className="text-muted text-sm">Cargando rendimiento de campañas…</p>
  } else if (error.campaigns) {
    performanceContent = <p className="text-sm text-[#D9534F]">{error.campaigns}</p>
  } else {
    performanceContent = (
      <SortableTable
        columns={performanceColumns}
        rows={campaigns}
        exportFilename="rendimiento-campanas"
        pageSize={200}
        emptyMessage="No hay rendimiento de campañas para el período seleccionado."
      />
    )
  }

  let funnelContent
  if (loading.funnel) {
    funnelContent = <p className="text-muted text-sm">Cargando datos del embudo…</p>
  } else if (error.funnel) {
    funnelContent = <p className="text-sm text-[#D9534F]">{error.funnel}</p>
  } else if (funnel.length === 0) {
    funnelContent = <p className="text-muted text-sm">No hay datos del embudo disponibles todavía.</p>
  } else {
    funnelContent = <div className="space-y-2">{funnel.map((row) => <div key={row.stage} className="flex justify-between items-center p-3 rounded-lg bg-surface border border-border"><span className="capitalize text-sm text-[#d7c5ae]">{String(row.stage).replaceAll('_', ' ')}</span><span className="font-bold text-sm">{(row.count ?? 0).toLocaleString()}{row.pct !== null && row.pct !== undefined ? ` (${row.pct}%)` : ''}</span></div>)}</div>
  }

  let conversationsContent
  if (loading.conversations) {
    conversationsContent = <p className="text-muted text-sm">Cargando conversaciones…</p>
  } else if (error.conversations) {
    conversationsContent = <p className="text-sm text-[#D9534F]">{error.conversations}</p>
  } else if (conversations.length === 0) {
    conversationsContent = <p className="text-muted text-sm">No se encontraron conversaciones.</p>
  } else {
    conversationsContent = <div className="space-y-3">{conversations.map((conv) => <div key={conv.id} className="p-3 bg-surface rounded-lg border border-border"><div className="flex justify-between"><p className="text-sm font-medium">{conv.phone ?? conv.id}</p><span className="text-xs text-muted capitalize">{conv.direction}</span></div>{conv.message_preview && <p className="text-xs text-muted mt-1 truncate">{conv.message_preview}</p>}{conv.sent_at && <p className="text-xs text-muted mt-1">{new Date(conv.sent_at).toLocaleString('es-ES')}</p>}</div>)}</div>
  }

  let traceabilityContent
  if (loading.traceability) {
    traceabilityContent = <p className="text-muted text-sm">Cargando trazabilidad…</p>
  } else if (error.traceability) {
    traceabilityContent = <p className="text-sm text-[#D9534F]">{error.traceability}</p>
  } else if (traceability.length === 0) {
    traceabilityContent = <div className="flex flex-col items-center justify-center py-12 text-center gap-3"><p className="text-[#d7c5ae] font-medium">No hay datos de trazabilidad todavía</p><p className="text-muted text-sm max-w-md">Cuando el sistema cruce Doctoralia por DNI, nombre o teléfono, cada lead se vinculará a su paciente y a sus liquidaciones.</p></div>
  } else {
    traceabilityContent = <SortableTable columns={traceabilityColumns} rows={traceabilityRows} exportFilename="trazabilidad-leads" pageSize={200} emptyMessage="No hay datos de trazabilidad todavía." />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Inteligencia</h1>
        <p className="text-muted mt-1">Rendimiento de campañas, embudo WhatsApp y registro de conversaciones</p>
        <MetaAccountsInline context="Inteligencia de campañas, conversaciones y trazabilidad asociada a estas cuentas Meta." className="mt-4 max-w-2xl" />
      </div>

      <Tabs defaultValue="performance" className="w-full">
        <TabsList>
          <TabsTrigger value="performance">Rendimiento</TabsTrigger>
          <TabsTrigger value="funnel">Embudo WhatsApp</TabsTrigger>
          <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
          <TabsTrigger value="traceability">Trazabilidad</TabsTrigger>
          <TabsTrigger value="daily-insights">Insights diarios</TabsTrigger>
        </TabsList>

        <TabsContent value="performance"><Card><CardHeader><CardTitle>Rendimiento de campañas</CardTitle></CardHeader><CardContent className="space-y-4"><FilterBar onDateChange={(from, to) => { setPerformanceFrom(from); setPerformanceTo(to) }} sources={performanceSources} sourceValue={performanceSource} onSourceChange={setPerformanceSource} />{performanceContent}</CardContent></Card></TabsContent>
        <TabsContent value="funnel"><Card><CardHeader><CardTitle>Embudo de conversión WhatsApp</CardTitle></CardHeader><CardContent>{funnelContent}</CardContent></Card></TabsContent>
        <TabsContent value="conversations"><Card><CardHeader><CardTitle>Conversaciones recientes</CardTitle></CardHeader><CardContent>{conversationsContent}</CardContent></Card></TabsContent>
        <TabsContent value="traceability"><Card><CardHeader><CardTitle>Lead → paciente → caja</CardTitle></CardHeader><CardContent className="space-y-4"><FilterBar onDateChange={(from, to) => { setTraceFrom(from); setTraceTo(to) }} sources={traceSources} sourceValue={traceSource} onSourceChange={setTraceSource} />{traceabilityContent}</CardContent></Card></TabsContent>
        <TabsContent value="daily-insights"><Card><CardHeader><CardTitle>Insights diarios de agentes</CardTitle><p className="text-xs text-muted">Generados automáticamente por daily-aggregates y agentes IA.</p></CardHeader><CardContent>{getDailyInsightsContent(dailyLoading, dailyInsights)}</CardContent></Card></TabsContent>
      </Tabs>
    </div>
  )
}
