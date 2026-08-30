import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clock3, GitBranch, TriangleAlert } from 'lucide-react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabaseClient'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

type PipelineStage =
  | 'new_lead'
  | 'contacted'
  | 'conversation'
  | 'valuation_scheduled'
  | 'valuation_completed'
  | 'treatment_proposed'
  | 'treatment_scheduled'
  | 'treatment_completed'
  | 'won'
  | 'lost'

type PipelineRow = {
  lead_id: string
  pipeline_stage: PipelineStage
  pipeline_stage_source: 'evidence' | 'explicit'
  next_action: string | null
  due_at: string | null
  verified_revenue: number | null
}

const stageOrder: PipelineStage[] = [
  'new_lead',
  'contacted',
  'conversation',
  'valuation_scheduled',
  'valuation_completed',
  'treatment_proposed',
  'treatment_scheduled',
  'treatment_completed',
  'won',
  'lost',
]

const stageLabels: Record<PipelineStage, string> = {
  new_lead: 'Nuevos',
  contacted: 'Contactados',
  conversation: 'Conversación',
  valuation_scheduled: 'Valoración programada',
  valuation_completed: 'Valoración realizada',
  treatment_proposed: 'Tratamiento propuesto',
  treatment_scheduled: 'Tratamiento programado',
  treatment_completed: 'Tratamiento realizado',
  won: 'Won',
  lost: 'Lost',
}

export function PipelineSnapshot() {
  const [rows, setRows] = useState<PipelineRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const PAGE_SIZE = 500
    let offset = 0
    const allRows: PipelineRow[] = []

    try {
      while (true) {
        const { data, error: rpcError } = await supabase.rpc('nvx_get_control_centre_pipeline', {
          p_limit: PAGE_SIZE,
          p_offset: offset,
        })
        if (rpcError) {
          setError(rpcError.message || 'No se pudo cargar el pipeline comercial.')
          setLoading(false)
          return
        }
        const chunk = (data || []) as PipelineRow[]
        allRows.push(...chunk)
        if (chunk.length < PAGE_SIZE) {
          break
        }
        offset += chunk.length
      }
      setRows(allRows)
    } catch (err: any) {
      setError(err?.message || 'Error inesperado cargando el pipeline.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const result = new Map<PipelineStage, number>()
    for (const stage of stageOrder) result.set(stage, 0)
    for (const row of rows) result.set(row.pipeline_stage, (result.get(row.pipeline_stage) || 0) + 1)
    return result
  }, [rows])

  const overdue = useMemo(() => {
    const now = Date.now()
    return rows.filter((row) => {
      if (!row.due_at || ['won', 'lost'].includes(row.pipeline_stage)) return false
      const due = Date.parse(row.due_at)
      return Number.isFinite(due) && due < now
    }).length
  }, [rows])

  const visibleStages = stageOrder.filter((stage) => (counts.get(stage) || 0) > 0)
  const revenue = rows.reduce((sum, row) => sum + Number(row.verified_revenue || 0), 0)

  return (
    <Card className="border-border/80" data-testid="control-centre-pipeline">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary" />Pipeline comercial canónico</CardTitle>
          <p className="mt-1 text-xs text-muted">Etapas derivadas de evidencia verificable o de una transición explícita auditada.</p>
        </div>
        <Link href="/crm" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Gestionar pacientes <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent>
        {loading && <p className="py-5 text-sm text-muted">Cargando pipeline…</p>}
        {!loading && error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/8 px-3 py-3 text-sm text-rose-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {visibleStages.map((stage) => (
                <div key={stage} className="rounded-xl border border-border bg-surface/50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{stageLabels[stage]}</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{counts.get(stage) || 0}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
              <span>{rows.length} oportunidades visibles</span>
              <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{overdue} acciones vencidas</span>
              <span>{revenue.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} de revenue verificado</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
