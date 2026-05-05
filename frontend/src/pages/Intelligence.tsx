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

  // Attribution filter state
  const [attrFrom, setAttrFrom] = useState<string>(() => new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
  const [attrTo, setAttrTo] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [attrSource, setAttrSource] = useState<string>('')

  const traceSources = useMemo(
    () => [...new Set(traceability.map((l: any) => l.source).filter(Boolean))] as string[],
    [traceability],
  )

  const attrSources = useMemo(
    () => [...new Set(campaigns.map((c: any) => c.source).filter(Boolean))] as string[],
    [campaigns],
  )

  const attributionColumns: ColDef[] = [
    { key: 'source', label: 'Fuente', align: 'left' },
    { key: 'campaign_name', label: 'Campaña', align: 'left' },
    { key: 'total_leads', label: 'Leads', align: 'right', sortable: true },
    { key: 'contacted', label: 'Contactados', align: 'right', sortable: true },
    { key: 'replied', label: 'Respondieron', align: 'right', sortable: true },
    { key: 'booked', label: 'Reservados', align: 'right', sortable: true },
    { key: 'closed_won', label: 'Ganados', align: 'right', sortable: true },
    { key: 'reply_rate_pct', label: 'Reply %', align: 'right', sortable: true,
      format: (v) => v === null || v === undefined ? null : `${v}%` },
    { key: 'lead_to_close_rate_pct', label: 'Cierre %', align: 'right', sortable: true,
      format: (v) => v === null || v === undefined ? null : `${v}%` },
    { key: 'verified_revenue_crm', label: 'Revenue', align: 'right', sortable: true,
      format: (v) => v === null || v === undefined ? null : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
    { key: 'avg_reply_delay_min', label: 'Resp. (min)', align: 'right', sortable: true,
      format: (v) => v === null || v === undefined ? null : String(v) },
  ]

  const traceabilityRows = useMemo(
    () => traceability.map((row: TraceabilityLead) => {
      let stage = 'Lead only';
      if ((row as any).doctoralia_net != null) {
        stage = 'Revenue';
      } else if ((row as any).patient_id) {
        stage = 'Patient';
      }
      return {
        ...row,
        _stage: stage,
      };
    }),
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
      format: (v) => v === null || v === undefined ? null : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }) },
    { key: 'first_settlement_at', label: '1ª liquidación', align: 'left',
      format: (v) => v ? new Date(v).toLocaleDateString('es-MX') : null },
    { key: 'settlement_date', label: 'Últ. liquidación', align: 'left',
      format: (v) => v ? new Date(v).toLocaleDateString('es-MX') : null },
    { key: 'match_confidence', label: 'Confianza', align: 'right',
      format: (v) => v === null || v === undefined ? null : `${(Number(v) * 100).toFixed(0)}%` },
    { key: 'match_class', label: 'Match', align: 'left',
      format: (v) => v ? String(v).replaceAll('_', ' ') : null },
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

  // Separate effect for attribution so filters trigger re-fetch
  useEffect(() => {
    const params: string[] = []
    if (attrFrom) params.push(`from=${attrFrom}`)
    if (attrTo)   params.push(`to=${attrTo}`)
    if (attrSource) params.push(`source=${encodeURIComponent(attrSource)}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    invokeApi(`/traceability/campaigns${qs}`)
      .then((data: any) => {
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : [])
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })
      .catch((err: any) => {
        setError((prev) => ({ ...prev, campaigns: err?.message || 'Failed to load campaigns.' }))
        setLoading((prev) => ({ ...prev, campaigns: false }))
      })
  }, [attrFrom, attrTo, attrSource])

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

  let attributionContent;
  if (loading.campaigns) {
    attributionContent = <p className="text-muted text-sm">Cargando datos de atribución…</p>;
  } else if (error.campaigns) {
    attributionContent = <p className="text-sm text-[#D9534F]">{error.campaigns}</p>;
  } else {
    attributionContent = (
      <SortableTable
        columns={attributionColumns}
        rows={campaigns as unknown as Record<string, unknown>[]}
        exportFilename="attribution-campaigns"
        pageSize={200}
        emptyMessage="No hay datos de atribución para el período seleccionado."
      />
    );
  }

  let funnelContent;
  if (loading.funnel) {
    funnelContent = <p className="text-muted text-sm">Cargando datos del embudo…</p>;
  } else if (error.funnel) {
    funnelContent = <p className="text-sm text-[#D9534F]">{error.funnel}</p>;
  } else if (funnel.length === 0) {
    funnelContent = <p className="text-muted text-sm">No hay datos del embudo disponibles todavía.</p>;
  } else {
    funnelContent = (
      <div className="space-y-2">
        {funnel.map((row) => (
          <div key={row.stage} className="flex justify-between items-center p-3 rounded-lg bg-surface border border-border">
            <span className="capitalize text-sm text-[#d7c5ae]">{String(row.stage).replaceAll('_', ' ')}</span>
            <span className="font-bold text-sm">
              {row.count.toLocaleString()}
              {row.pct !== null && row.pct !== undefined ? ` (${row.pct}%)` : ''}
            </span>
          </div>
        ))}
      </div>
    );
  }

  let conversationsContent;
  if (loading.conversations) {
    conversationsContent = <p className="text-muted text-sm">Cargando conversaciones…</p>;
  } else if (error.conversations) {
    conversationsContent = <p className="text-sm text-[#D9534F]">{error.conversations}</p>;
  } else if (conversations.length === 0) {
    conversationsContent = <p className="text-muted text-sm">No se encontraron conversaciones.</p>;
  } else {
    conversationsContent = (
      <div className="space-y-3">
        {conversations.map((conv) => (
          <div key={conv.id} className="p-3 bg-surface rounded-lg border border-border">
            <div className="flex justify-between">
              <p className="text-sm font-medium">{conv.phone ?? conv.id}</p>
              <span className="text-xs text-muted capitalize">{conv.direction}</span>
            </div>
            {conv.message_preview && (
              <p className="text-xs text-muted mt-1 truncate">{conv.message_preview}</p>
            )}
            {conv.sent_at && (
              <p className="text-xs text-muted mt-1">{new Date(conv.sent_at).toLocaleString()}</p>
            )}
          </div>
        ))}
      </div>
    );
  }

  let traceabilityContent;
  if (loading.traceability) {
    traceabilityContent = <p className="text-muted text-sm">Cargando trazabilidad…</p>;
  } else if (error.traceability) {
    traceabilityContent = <p className="text-sm text-[#D9534F]">{error.traceability}</p>;
  } else if (traceability.length === 0) {
    traceabilityContent = (
      <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
        <p className="text-[#d7c5ae] font-medium">No hay datos de trazabilidad todavía</p>
        <p className="text-muted text-sm max-w-md">
          Cuando el sistema ejecute el matching de Doctoralia (por DNI o nombre/teléfono),
          cada lead se vinculará a su paciente y a su historial de liquidaciones.
          Los datos aparecerán aquí automáticamente.
        </p>
      </div>
    );
  } else {
    traceabilityContent = (
      <SortableTable
        columns={traceabilityColumns}
        rows={traceabilityRows}
        exportFilename="traceability-leads"
        pageSize={200}
        emptyMessage="No hay datos de trazabilidad todavía."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Inteligencia</h1>
        <p className="text-muted mt-1">Atribución de campañas, embudo WhatsApp y registro de conversaciones</p>
      </div>

      <Tabs defaultValue="attribution" className="w-full">
        <TabsList>
          <TabsTrigger value="attribution">Atribución</TabsTrigger>
          <TabsTrigger value="funnel">Embudo WhatsApp</TabsTrigger>
          <TabsTrigger value="conversations">Conversaciones</TabsTrigger>
          <TabsTrigger value="traceability">Trazabilidad</TabsTrigger>
        </TabsList>

        <TabsContent value="attribution">
          <Card>
            <CardHeader>
              <CardTitle>Atribución multi-touch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FilterBar
                onDateChange={(from, to) => { setAttrFrom(from); setAttrTo(to) }}
                sources={attrSources}
                sourceValue={attrSource}
                onSourceChange={setAttrSource}
              />
              {attributionContent}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel">
          <Card>
            <CardHeader>
              <CardTitle>Embudo de conversión WhatsApp</CardTitle>
            </CardHeader>
            <CardContent>
              {funnelContent}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversations">
          <Card>
            <CardHeader>
              <CardTitle>Conversaciones recientes</CardTitle>
            </CardHeader>
            <CardContent>
              {conversationsContent}
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
              {traceabilityContent}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
