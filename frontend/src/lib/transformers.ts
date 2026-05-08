import type { DoctoraliaAppointment, LiveEvent } from '../types'

/**
 * Transforms a raw database row from doctoralia_raw into a structured DoctoraliaAppointment object.
 */
export function transformDoctoraliaAppointment(r: any): DoctoraliaAppointment {
  return {
    raw_hash: r.raw_hash,
    paciente_nombre: r.paciente_nombre ?? r.patient_name ?? null,
    hora: r.hora_inicio ?? r.hora ?? null,
    estado: r.estado ?? null,
    asunto: r.procedimiento_nombre ?? r.treatment ?? r.asunto ?? null,
    agenda: r.agenda ?? null,
    sala_box: r.sala_box ?? null,
    procedencia: r.procedencia ?? null,
    importe: r.importe_numerico ?? r.importe ?? null,
    confirmada: r.confirmada ?? false,
    timestamp_cita: r.timestamp_cita ?? null,
    doc_patient_id: r.doc_patient_id ?? null,
    lead_id: r.lead_id ?? null,
    campaign_name: r.campaign_name ?? null,
    match_class: r.match_class ?? null,
    match_confidence: r.match_confidence ?? null,
  }
}

/**
 * Transforms raw data from different sources into a uniform LiveEvent for the activity feed.
 */
export function transformLiveEvent(source: 'DOCTORALIA' | 'META' | 'CRM', r: any): LiveEvent {
  if (source === 'DOCTORALIA') {
    return {
      id: String(r.raw_hash ?? `doctoralia-${Math.random()}`),
      type: 'DOCTORALIA',
      label: r.paciente_nombre ?? r.patient_name ?? 'Paciente Doctoralia',
      detail: [
        r.agenda,
        r.estado,
        r.importe_numerico != null ? `€${Number(r.importe_numerico).toLocaleString('es-ES', { minimumFractionDigits: 0 })}` : ''
      ].filter(Boolean).join(' · '),
      ts: r.timestamp_cita ?? (r.fecha ? `${r.fecha}T09:00:00Z` : new Date().toISOString()),
    }
  }
  
  // Default fallback
  return {
    id: String(r.id ?? Math.random()),
    type: source,
    label: r.label ?? r.name ?? 'Nuevo evento',
    detail: r.detail ?? '',
    ts: r.created_at ?? new Date().toISOString(),
  }
}
