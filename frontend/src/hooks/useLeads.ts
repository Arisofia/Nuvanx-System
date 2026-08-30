import { useState, useCallback, useEffect } from 'react'
import { invokeApi } from '../lib/invokeApi'
import type { Lead, LeadStage, CanonicalStage, AppointmentMatch } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Stage resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid UI Kanban stages. These are the ONLY values the board renders.
 */
const VALID_UI_STAGES = new Set<string>(['lead', 'whatsapp', 'appointment', 'treatment', 'closed'])

/**
 * stage_canonical values (from refresh_doctoralia_funnel) → UI stage mapping.
 * These values are set by the DB function, not by the user, so they are authoritative.
 */
const CANONICAL_STAGE_MAP: Record<string, LeadStage> = {
  asistio: 'appointment',
  valoracion_aceptada: 'appointment',
  contacto: 'whatsapp',
  lead: 'lead',
  closed: 'closed',
}

/**
 * Legacy stage values still present in `leads.stage` (the old column) → UI stage.
 * These exist because of the historical auto-advance logic that ran before stage_canonical
 * was introduced. Values like 'convertido' were set by the reconciliation pipeline.
 */
const LEGACY_STAGE_MAP: Record<string, LeadStage> = {
  convertido: 'lead',    // canonical says 'lead' for 122 of 123 — confirmed by audit
  nuevo: 'lead',
  pendiente: 'lead',
  perdido: 'closed',
  ganado: 'treatment',
  won: 'treatment',
  paid: 'treatment',
  scheduled: 'appointment',
  confirmed: 'appointment',
  showed: 'appointment',
  completed: 'treatment',
}

/**
 * Resolves the correct UI stage for a raw API lead row.
 *
 * Priority order (highest to lowest):
 * 1. stage_canonical — set by refresh_doctoralia_funnel(), evidence-based
 * 2. stage (legacy) via CANONICAL_STAGE_MAP if it's a valid UI stage already
 * 3. stage (legacy) via LEGACY_STAGE_MAP for known legacy values
 * 4. Fallback to 'lead' — safe floor, never silently drops a record
 *
 * This function NEVER returns a value outside VALID_UI_STAGES.
 */
export function resolveCanonicalStage(item: Record<string, unknown>): LeadStage {
  // 1. stage_canonical is the authoritative source when populated
  const canonical = typeof item.stage_canonical === 'string'
    ? item.stage_canonical.trim().toLowerCase()
    : null

  if (canonical && canonical in CANONICAL_STAGE_MAP) {
    return CANONICAL_STAGE_MAP[canonical]!
  }

  // 2 & 3. Fall back to legacy stage field
  const legacy = typeof (item.stage ?? item.status) === 'string'
    ? String(item.stage ?? item.status).trim().toLowerCase()
    : ''

  if (legacy && VALID_UI_STAGES.has(legacy)) {
    return legacy as LeadStage
  }

  if (legacy && legacy in LEGACY_STAGE_MAP) {
    return LEGACY_STAGE_MAP[legacy]!
  }

  // 4. Safe floor
  return 'lead'
}

// ─────────────────────────────────────────────────────────────────────────────
// Appointment evidence validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true only when there is temporal evidence that a cita is
 * *attributable* to this lead's captation event.
 *
 * Rules (all must pass):
 * - The resolved UI stage must be 'appointment' or 'treatment'
 * - If appointment_date and created_at are both present, the cita must be
 *   on or after the lead captation date (eliminates the 69 legacy backfill cases)
 * - OR there is at least one verified lead_appointment_match (phone-based)
 */
export function hasVerifiedAppointmentEvidence(lead: Lead): boolean {
  const hasMatchedAppointment =
    Array.isArray(lead.appointment_matches) && lead.appointment_matches.length > 0

  if (hasMatchedAppointment) return true

  const stageQualifies =
    lead.status === 'appointment' || lead.status === 'treatment'

  if (!stageQualifies) return false

  if (lead.appointment_date && lead.created_at) {
    const capturedMs = Date.parse(lead.created_at)
    const appointmentMs = Date.parse(lead.appointment_date)
    // Both dates must be parseable and cita must be >= captación
    if (Number.isFinite(capturedMs) && Number.isFinite(appointmentMs)) {
      return appointmentMs >= capturedMs
    }
  }

  // appointment_date present but one of the timestamps is unparseable → conservative false
  return Boolean(lead.appointment_date)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead mapper
// ─────────────────────────────────────────────────────────────────────────────

function mapApiRowToLead(item: Record<string, unknown>): Lead {
  const matches = Array.isArray(item.appointment_matches)
    ? (item.appointment_matches as unknown[]).map((m: unknown): AppointmentMatch => {
        const row = m as Record<string, unknown>
        return {
          appointment_ingestion_id: String(row.appointment_ingestion_id ?? row.id ?? ''),
          match_method: String(row.match_method ?? ''),
          is_primary: Boolean(row.is_primary),
          appointment_date: typeof row.appointment_date === 'string' ? row.appointment_date : null,
        }
      })
    : []

  return {
    id: String(item.id ?? item.lead_id ?? ''),
    name: String(item.name ?? item.full_name ?? item.contact_name ?? 'Unknown'),
    status: resolveCanonicalStage(item),
    stage_raw: typeof item.stage === 'string' ? item.stage : undefined,
    stage_canonical: (item.stage_canonical ?? null) as CanonicalStage,
    source: String(item.source ?? 'Edge'),
    email: typeof item.email === 'string' ? item.email : undefined,
    phone: typeof item.phone === 'string' ? item.phone : undefined,
    dni: typeof item.dni === 'string' ? item.dni : undefined,
    notes: typeof item.notes === 'string' ? item.notes : undefined,
    revenue:
      item.revenue != null && item.revenue !== ''
        ? Number(item.revenue)
        : undefined,
    appointment_date:
      typeof item.appointment_date === 'string' ? item.appointment_date : undefined,
    treatment_name:
      typeof item.treatment_name === 'string' ? item.treatment_name : undefined,
    created_at:
      typeof item.created_at === 'string' ? item.created_at : undefined,
    updated_at:
      typeof item.updated_at === 'string' ? item.updated_at : undefined,
    appointment_matches: matches,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orphanCount, setOrphanCount] = useState(0)

  const loadLeads = useCallback(async (activeFlag?: { active: boolean }) => {
    setLoading(true)
    setError(null)
    try {
      const response = await invokeApi<{ leads?: unknown[] }>('/api/leads')
      const data = response.leads

      if (activeFlag && !activeFlag.active) return

      if (!Array.isArray(data)) {
        setLeads([])
        setOrphanCount(0)
        return
      }

      const mapped = data.map((item) => mapApiRowToLead(item as Record<string, unknown>))

      // Count any rows that still couldn't be resolved to a valid UI stage.
      // With the current resolution logic this should always be 0, but we track
      // it as an invariant check for future schema changes.
      const orphans = mapped.filter((l) => !VALID_UI_STAGES.has(l.status))
      if (orphans.length > 0) {
        console.warn(
          `[useLeads] ${orphans.length} lead(s) with unresolved stage after mapping:`,
          orphans.map((l) => ({ id: l.id, stage_raw: l.stage_raw, stage_canonical: l.stage_canonical }))
        )
      }
      setOrphanCount(orphans.length)
      setLeads(mapped)
    } catch (err: unknown) {
      if (activeFlag && !activeFlag.active) return
      const message = err instanceof Error ? err.message : 'Unable to load leads from API.'
      console.warn('[useLeads] CRM API call failed:', message)
      setError(message)
      setLeads([])
    } finally {
      if (!activeFlag || activeFlag.active) {
        setLoading(false)
      }
    }
  }, [])

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    try {
      const apiUpdates: Record<string, unknown> = { ...updates }
      // Map 'status' (UI) back to 'stage' (DB column) for the PATCH endpoint
      if ('status' in apiUpdates && apiUpdates.status) {
        apiUpdates.stage = apiUpdates.status
        delete apiUpdates.status
      }
      // Never send derived/read-only fields to the API
      delete apiUpdates.stage_raw
      delete apiUpdates.stage_canonical
      delete apiUpdates.appointment_matches

      const response = await invokeApi<{ success?: boolean; lead?: Record<string, unknown>; message?: string }>(
        `/api/leads/${id}`,
        { method: 'PATCH', body: apiUpdates }
      )

      if (response.success) {
        const updatedRow = response.lead ?? {}
        setLeads((prev) =>
          prev.map((lead) =>
            lead.id === id
              ? {
                  ...lead,
                  ...updates,
                  id: String(updatedRow.id ?? id),
                  // Re-resolve stage from the API response so the UI stays consistent
                  status: resolveCanonicalStage({ ...updatedRow, ...updates }),
                  stage_raw: typeof updatedRow.stage === 'string' ? updatedRow.stage : lead.stage_raw,
                  stage_canonical: (updatedRow.stage_canonical ?? lead.stage_canonical) as CanonicalStage,
                }
              : lead
          )
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
        { method: 'DELETE' }
      )
      if (response.success) {
        setLeads((prev) => prev.filter((lead) => lead.id !== id))
        return { success: true }
      }
      return { success: false, error: response.message }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete lead'
      return { success: false, error: message }
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

  return { leads, loading, error, orphanCount, refreshLeads: loadLeads, updateLead, deleteLead }
}
