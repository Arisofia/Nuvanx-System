import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Clock3, GitBranch, TriangleAlert } from 'lucide-react'
import { Link } from 'wouter'
import { supabase } from '../../lib/supabaseClient'
import {
  PIPELINE_STAGES,
  isCanonicalPipelineStage,
  type CanonicalPipelineStage,
} from '../../lib/pipeline'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

type PipelineRow = {
  lead_id: string
  pipeline_stage: CanonicalPipelineStage
  pipeline_stage_source: 'evidence' | 'explicit'
  next_action: string | null
  due_at: string | null
  verified_revenue: number | null
  journey_appointment_count?: number | null
  is_new_client?: boolean | null
}

const stageOrder = PIPELINE_STAGES.map((stage) => stage.id)
const stageLabels = Object.fromEntries(
  PIPELINE_STAGES.map((stage) => [stage.id, stage.label]),
) as Record<CanonicalPipelineStage, string>

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
          return
        }

        const chunk = (Array.isArray(data) ? data : []) as PipelineRow[]
        if (chunk.some((row) => !isCanonicalPipelineStage(row.pipeline_stage))) {
          setError('El pipeline devolvió una etapa no reconocida.')
          return
        }
        allRows.push(...chunk)
        if (chunk.length < PAGE_SIZE) break
        offset += chunk.length
      }
      setRows(allRows)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado cargando el pipeline.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const result = new Map<CanonicalPipelineStage, number>()
    for (const stage of stageOrder) result.set(stage, 0)
    for (const row of rows) result.set(row.pipeline_stage, (result.get(row.pipeline_stage) || 0) + 1)
    return result
  }, [rows])

  const journey = useMemo(() => ({
    valuation: rows.filter((row) => Number(row.journey_appointment_count ?? 0) >= 1).length,
    treatment: rows.filter((row) => Number(row.journey_appointment_count ?? 0) >= 2).length,
    control: rows.filter((row) => Number(row.journey_appointment_count ?? 0) >= 3).length,
    newClients: rows.filter((row) => row.is_new_client === true).length,
  }), [rows])

  const overdue = useMemo(() => {
    const now = Date.now()
    return rows.filter((row) => {
      if (!row.due_at || ['client_completed', 'lost'].includes(row.pipeline_stage)) return false
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
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />Pipeline comercial canónico
          </CardTitle>
          <p className="mt-1 text-xs text-muted">
            Journey Doctoralia: 1ª valoración · 2ª tratamiento · 3ª primer control. El cobro no determina la etapa.
          </p>
        </div>
        <Link href="/crm" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          Gestionar CRM <ArrowRight className="h-3.5 w-3.5" />
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['1/3 · Valoración', journey.valuation],
                ['2/3 · Tratamiento', journey.treatment],
                ['3/3 · 1er control', journey.control],
                ['Clientes nuevos', journey.newClients],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-border bg-surface/50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {visibleStages.map((stage) => (
                <div key={stage} className="rounded-xl border border-border bg-surface/30 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{stageLabels[stage]}</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">{counts.get(stage) || 0}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
              <span>{rows.length} oportunidades visibles</span>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />{overdue} acciones vencidas
              </span>
              <span>
                {revenue.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                {' '}de revenue vinculado · métrica financiera separada del journey
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
