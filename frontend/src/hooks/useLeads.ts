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
  verified_revenue?: number | null
  created_at?: string | null
  updated_at?: string | null
}

const PIPELINE_PAGE_SIZE = 500

async function fetchCanonicalPipeline(): Promise<PipelineRow[]> {
  const rows: PipelineRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase.rpc('nvx_get_control_centre_pipeline', {
      p_limit: PIPELINE_PAGE_SIZE,
      p_offset: offset,
    })
    if (error) throw error

    const page = Array.isArray(data) ? data as PipelineRow[] : []
    for (const row of page) {
      if (!row?.lead_id || !isCanonicalPipelineStage(row.pipeline_stage)) {
        throw new Error('El pipeline canónico devolvió una etapa inválida. Se bloqueó el CRM para no mostrar estados legacy como evidencia.')
      }
      rows.push(row)
    }

    if (page.length < PIPELINE_PAGE_SIZE) break
    offset += page.length
  }

  return rows
}

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLeads = useCallback(async (activeFlag?: { active: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const [response, pipelineRows] = await Promise.all([
        invokeApi<{ leads?: any[] }>('/api/leads'),
        fetchCanonicalPipeline(),
      ])
      const rawLeads = Array.isArray(response.leads) ? response.leads : []
      const rawById = new Map(rawLeads.map((item: any) => [String(item.id ?? item.lead_id ?? ''), item]))

      if (activeFlag && !activeFlag.active) return

      setLeads(
        pipelineRows.map((pipeline) => {
          const item: any = rawById.get(String(pipeline.lead_id)) ?? {}
          return {
            id: String(pipeline.lead_id),
            name: item.name ?? pipeline.name ?? item.full_name ?? item.contact_name ?? 'Sin nombre',
            status: pipeline.pipeline_stage,
            source: item.source ?? pipeline.source ?? 'unknown',
            email: item.email,
            phone: item.phone,
            dni: item.dni,
            notes: item.notes,
            revenue: item.revenue,
            appointment_date: item.appointment_date,
            treatment_name: item.treatment_name ?? pipeline.treatment_name ?? undefined,
            created_at: item.created_at ?? pipeline.created_at ?? undefined,
            updated_at: item.updated_at ?? pipeline.updated_at ?? undefined,
          }
        }),
      )
    } catch (err: any) {
      if (activeFlag && !activeFlag.active) return
      console.warn('Canonical CRM load failed:', err)
      setError(err?.message || 'No se pudo cargar el pipeline canónico. El CRM se mantiene vacío para evitar mostrar etapas legacy como si fueran evidencia.')
      setLeads([])
    } finally {
      if (!activeFlag || activeFlag.active) {
        setLoading(false)
      }
    }
  }, [])

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    try {
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        return {
          success: false,
          error: 'La etapa comercial se deriva del pipeline canónico y no se puede sobrescribir desde la ficha legacy.',
        }
      }

      const response = await invokeApi<{ success?: boolean; lead?: any; message?: string }>(`/api/leads/${id}`, {
        method: 'PATCH',
        body: updates,
      })

      if (response.success) {
        setLeads(prev =>
          prev.map(lead =>
            lead.id === id
              ? {
                  ...lead,
                  ...updates,
                  id: String(response.lead?.id ?? id),
                  status: lead.status,
                }
              : lead,
          ),
        )
        return { success: true }
      }
      return { success: false, error: response.message }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update lead' }
    }
  }

  const deleteLead = async (id: string) => {
    try {
      const response = await invokeApi<{ success?: boolean; message?: string }>(`/api/leads/${id}`, { method: 'DELETE' })
      if (response.success) {
        setLeads(prev => prev.filter(lead => lead.id !== id))
        return { success: true }
      }
      return { success: false, error: response.message }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete lead' }
    }
  }

  useEffect(() => {
    const activeFlag = { active: true }
    const timer = setTimeout(() => {
      void loadLeads(activeFlag)
    }, 0)
    return () => {
      activeFlag.active = false
      clearTimeout(timer)
    }
  }, [loadLeads])

  return { leads, loading, error, refreshLeads: loadLeads, updateLead, deleteLead }
}
