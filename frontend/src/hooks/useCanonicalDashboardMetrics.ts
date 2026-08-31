import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export interface CanonicalDashboardMetricPayload {
  totalLeads: number
  conversionRate: number
  patientMatches: number
  patientConversionRate: number
  verifiedRevenue: number
  newClients: number
  clientCompleted: number
  valuationCount: number
  treatmentCount: number
  controlCount: number
  byStage: Record<string, number>
  bySource: Record<string, number>
  deltas: {
    leads: number | null
    revenue: number | null
    conversions: number | null
    patientMatches: number | null
  }
}

export interface CanonicalFunnelRow {
  stage: string
  label: string
  count: number
  percentage: number
}

interface CanonicalDashboardPayload {
  metrics: CanonicalDashboardMetricPayload
  funnel: CanonicalFunnelRow[]
  contract: string
}

interface CanonicalDashboardState {
  metrics: CanonicalDashboardMetricPayload | null
  funnel: CanonicalFunnelRow[]
  loading: boolean
  error: string | null
}

const EMPTY_STATE: CanonicalDashboardState = {
  metrics: null,
  funnel: [],
  loading: true,
  error: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isNumericRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber)
}

function isCanonicalFunnelRow(value: unknown): value is CanonicalFunnelRow {
  if (!isRecord(value)) return false
  return typeof value.stage === 'string'
    && typeof value.label === 'string'
    && isFiniteNumber(value.count)
    && isFiniteNumber(value.percentage)
}

function isCanonicalPayload(value: unknown): value is CanonicalDashboardPayload {
  if (!isRecord(value) || value.contract !== 'canonical_journey_v2') return false
  if (!isRecord(value.metrics) || !Array.isArray(value.funnel)) return false

  const metrics = value.metrics
  const deltas = metrics.deltas
  const requiredNumbers = [
    metrics.totalLeads,
    metrics.conversionRate,
    metrics.patientMatches,
    metrics.patientConversionRate,
    metrics.verifiedRevenue,
    metrics.newClients,
    metrics.clientCompleted,
    metrics.valuationCount,
    metrics.treatmentCount,
    metrics.controlCount,
  ]

  if (!requiredNumbers.every(isFiniteNumber)) return false
  if (!isNumericRecord(metrics.byStage) || !isNumericRecord(metrics.bySource)) return false
  if (!isRecord(deltas)) return false
  if (!isNullableFiniteNumber(deltas.leads)
    || !isNullableFiniteNumber(deltas.revenue)
    || !isNullableFiniteNumber(deltas.conversions)
    || !isNullableFiniteNumber(deltas.patientMatches)) return false

  return value.funnel.every(isCanonicalFunnelRow)
}

export function useCanonicalDashboardMetrics(
  from: string,
  to: string,
  campaignId: string,
  sourceFilter: string,
) {
  const [state, setState] = useState<CanonicalDashboardState>(EMPTY_STATE)

  useEffect(() => {
    let active = true

    const load = async () => {
      setState((previous) => ({ ...previous, loading: true, error: null }))

      const { data, error } = await supabase.rpc('nvx_get_dashboard_metrics_v2', {
        p_from: from,
        p_to: to,
        p_campaign_id: campaignId === 'ALL' ? null : campaignId,
        p_source: sourceFilter === 'ALL' ? null : sourceFilter,
      })

      if (!active) return

      if (error) {
        setState({ metrics: null, funnel: [], loading: false, error: error.message })
        return
      }

      if (!isCanonicalPayload(data)) {
        setState({
          metrics: null,
          funnel: [],
          loading: false,
          error: 'El contrato de métricas canónicas no es válido.',
        })
        return
      }

      setState({
        metrics: data.metrics,
        funnel: data.funnel,
        loading: false,
        error: null,
      })
    }

    load()
    return () => { active = false }
  }, [from, to, campaignId, sourceFilter])

  return state
}
