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

function isCanonicalPayload(value: unknown): value is CanonicalDashboardPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return payload.contract === 'canonical_journey_v2'
    && Boolean(payload.metrics && typeof payload.metrics === 'object')
    && Array.isArray(payload.funnel)
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
