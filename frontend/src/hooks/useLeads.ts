import { useState, useCallback, useEffect } from 'react'
import { invokeApi } from '../lib/invokeApi'
import { supabase } from '../lib/supabaseClient'
import { isCanonicalPipelineStage, type CanonicalPipelineStage } from '../lib/pipeline'
import type { Lead } from '../types'

type PipelineRow = {
  lead_id: string
  name?: string | null
  source?: string | null
  treatment_name?: string | null
  pipeline_stage: CanonicalPipelineStage
  pipeline_stage_source?: 'evidence' | 'explicit' | null
  verified_revenue?: number | null
  created_at?: string | null
  updated_at?: string | null
  journey_appointment_count?: number | null
  valuation_appointment_date?: string | null
  treatment_appointment_date?: string | null
  first_control_appointment_date?: string | null
  is_new_client?: boolean | null
  client_completed_at?: string | null
  journey_identity_source?: 'doctoralia_id' | 'phone_normalized' | null
}

type LeadLoadContext = {
  active: boolean
  signal?: AbortSignal
}

const PIPELINE_PAGE_SIZE = 500

async function fetchCanonicalPipeline(signal?: AbortSignal): Promise<PipelineRow[]> {
  const rows: PipelineRow[] = []
  let offset = 0

  while (true) {
    const query = supabase.rpc('nvx_get_control_centre_pipeline', {
      p_limit: PIPELINE_PAGE_SIZE,
      p_offset: offset,
    })
    const { data, error } = signal ? await query.abortSignal(signal) : await query
    if (error) throw error

    const page = Array.isArray(data) ? data as PipelineRow[] : []
    for (const row of page) {
      if (!row?.lead_id || !isCanonicalPipelineStage(row.pipeline_stage)) {
        throw new Error(
          'El pipeline canónico devolvió una etapa inválida. Se bloqueó el CRM para no mostrar estados legacy como evidencia.',
        )
      }
      rows.push(row)
    }

    if (page.length < PIPELINE_PAGE_SIZE) break
    offset += page.length
  }

  return rows
}

async function fetchOptionalLeadMetadata(signal?: AbortSignal): Promise<Map<string, Record<string, unknown>>> {
  try {
    const response = await invokeApi<{ leads?: Record<string, unknown>[] }>('/api/leads', { signal })
    const rawLeads = Array.isArray(response.leads) ? response.leads : []
    return new Map(rawLeads.map((item) => [String(item.id ?? item.lead_id ?? ''), item]))
  } catch (err: unknown) {
    // Route changes and React lifecycle cleanup intentionally abort this optional
    // enrichment request. Do not report those cancellations as degraded CRM
    // health; genuine network/CORS/HTTP failures remain observable and are hard
    // failures in the production E2E gate.
    if (signal?.aborted) return new Map()
    const message = err instanceof Error ? err.message : 'metadata endpoint unavailable'
    console.warn('Legacy lead metadata unavailable; canonical CRM remains active:', message)
    return new Map()
  }
}

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLeads = useCallback(async (context?: LeadLoadContext) => {
    setLoading(true)
    setError(null)
    try {
      const pipelineRows = await fetchCanonicalPipeline(context?.signal)
      const rawById = await fetchOptionalLeadMetadata(context?.signal)

      if (context && !context.active) return

      setLeads(
        pipelineRows.map((pipeline) => {
          const item = rawById.get(String(pipeline.lead_id)) ?? {}
          return {
            id: String(pipeline.lead_id),
            name: String(
              item.name
              ?? pipeline.name
              ?? item.full_name
              ?? item.contact_name
              ?? 'Sin nombre',
            ),
            status: pipeline.pipeline_stage,
            stage_raw: typeof item.stage === 'string' ? item.stage : undefined,
            stage_canonical: typeof item.stage_canonical === 'string' ? item.stage_canonical : null,
            source: String(item.source ?? pipeline.source ?? 'unknown'),
            email: typeof item.email === 'string' ? item.email : undefined,
            phone: typeof item.phone === 'string' ? item.phone : undefined,
            dni: typeof item.dni === 'string' ? item.dni : undefined,
            notes: typeof item.notes === 'string' ? item.notes : undefined,
            revenue: item.revenue != null && item.revenue !== '' ? Number(item.revenue) : undefined,
            verified_revenue: pipeline.verified_revenue == null ? undefined : Number(pipeline.verified_revenue),
            appointment_date: pipeline.valuation_appointment_date ?? undefined,
            treatment_name: typeof item.treatment_name === 'string'
              ? item.treatment_name
              : pipeline.treatment_name ?? undefined,
            created_at: typeof item.created_at === 'string'
              ? item.created_at
              : pipeline.created_at ?? undefined,
            updated_at: typeof item.updated_at === 'string'
              ? item.updated_at
              : pipeline.updated_at ?? undefined,
            pipeline_stage_source: pipeline.pipeline_stage_source === 'explicit' ? 'explicit' : 'evidence',
            journey_appointment_count: Number(pipeline.journey_appointment_count ?? 0),
            valuation_appointment_date: pipeline.valuation_appointment_date ?? null,
            treatment_appointment_date: pipeline.treatment_appointment_date ?? null,
            first_control_appointment_date: pipeline.first_control_appointment_date ?? null,
            is_new_client: pipeline.is_new_client === true,
            client_completed_at: pipeline.client_completed_at ?? null,
            journey_identity_source: pipeline.journey_identity_source ?? null,
          } satisfies Lead
        }),
      )
    } catch (err: unknown) {
      if (context?.signal?.aborted || (context && !context.active)) return
      const message = err instanceof Error ? err.message : 'No se pudo cargar el pipeline canónico.'
      console.warn('Canonical CRM load failed:', message)
      setError(
        `${message} El CRM se mantiene vacío para evitar mostrar etapas legacy como si fueran evidencia.`,
      )
      setLeads([])
    } finally {
      if (!context || context.active) setLoading(false)
    }
  }, [])

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    try {
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        return {
          success: false,
          error: 'Las etapas clínicas se derivan de la secuencia Doctoralia y no pueden sobrescribirse desde la ficha del lead.',
        }
      }

      const apiUpdates: Partial<Lead> = { ...updates }
      delete apiUpdates.stage_raw
      delete apiUpdates.stage_canonical
      delete apiUpdates.pipeline_stage_source
      delete apiUpdates.journey_appointment_count
      delete apiUpdates.valuation_appointment_date
      delete apiUpdates.treatment_appointment_date
      delete apiUpdates.first_control_appointment_date
      delete apiUpdates.is_new_client
      delete apiUpdates.client_completed_at
      delete apiUpdates.journey_identity_source
      delete apiUpdates.verified_revenue

      const response = await invokeApi<{
        success?: boolean
        lead?: Record<string, unknown>
        message?: string
      }>(`/api/leads/${id}`, {
        method: 'PATCH',
        body: apiUpdates,
      })

      if (response.success) {
        setLeads((previous) =>
          previous.map((lead) =>
            lead.id === id
              ? {
                  ...lead,
                  ...apiUpdates,
                  id: String(response.lead?.id ?? id),
                  status: lead.status,
                }
              : lead,
          ),
        )
        return { success: true }
      }
      return { success: false, error: response.message }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update lead'
      return { success: false, error: message }
    }
  }

  const deleteLead = async (id: string) => {
    try {
      const response = await invokeApi<{ success?: boolean; message?: string }>(
        `/api/leads/${id}`,
        { method: 'DELETE' },
      )
      if (response.success) {
        setLeads((previous) => previous.filter((lead) => lead.id !== id))
        return { success: true }
      }
      return { success: false, error: response.message }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete lead'
      return { success: false, error: message }
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const context: LeadLoadContext = { active: true, signal: controller.signal }
    const timer = setTimeout(() => {
      void loadLeads(context)
    }, 0)
    return () => {
      context.active = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [loadLeads])

  return { leads, loading, error, refreshLeads: loadLeads, updateLead, deleteLead }
}
