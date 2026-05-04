import { useState, useCallback, useEffect } from 'react'
import { invokeApi } from '../lib/supabaseClient'
import type { Lead } from '../types'

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await invokeApi('/leads')
      const data = (response as any).leads

      setLeads(
        Array.isArray(data)
          ? data.map((item: any) => ({
              id: String(item.id ?? item.lead_id ?? ''),
              name: item.name ?? item.full_name ?? item.contact_name ?? 'Unknown',
              status: item.stage ?? item.status ?? 'Unknown',
              source: item.source ?? 'Edge',
              email: item.email,
              phone: item.phone,
              dni: item.dni,
              notes: item.notes,
              revenue: item.revenue,
              created_at: item.created_at,
              updated_at: item.updated_at,
            }))
          : [],
      )
    } catch (err: any) {
      console.warn('CRM API call failed:', err)
      setError(err?.message || 'Unable to load leads from API.')
      setLeads([])
    } finally {
      setLoading(false)
    }
  }, [])

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    try {
      // Map 'status' back to 'stage' for the API if necessary
      const apiUpdates: Record<string, unknown> = { ...updates }
      if ('status' in apiUpdates && apiUpdates.status) {
        apiUpdates.stage = apiUpdates.status
        delete apiUpdates.status
      }

      const response = await invokeApi(`/leads/${id}`, {
        method: 'PATCH',
        body: apiUpdates,
      })

      if ((response as any).success) {
        const updatedLead = (response as any).lead
        setLeads(prev =>
          prev.map(lead =>
            lead.id === id
              ? {
                  ...lead,
                  ...updates,
                  id: String(updatedLead.id),
                  status: updatedLead.stage,
                }
              : lead,
          ),
        )
        return { success: true }
      }
      return { success: false, error: (response as any).message }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to update lead' }
    }
  }

  const deleteLead = async (id: string) => {
    try {
      const response = await invokeApi(`/leads/${id}`, { method: 'DELETE' })
      if ((response as any).success) {
        setLeads(prev => prev.filter(lead => lead.id !== id))
        return { success: true }
      }
      return { success: false, error: (response as any).message }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to delete lead' }
    }
  }

  useEffect(() => {
    loadLeads()
  }, [loadLeads])

  return { leads, loading, error, refreshLeads: loadLeads, updateLead, deleteLead }
}
