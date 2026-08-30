export const PIPELINE_STAGES = [
  { id: 'new_lead', label: 'Nuevo lead' },
  { id: 'contacted', label: 'Contactado' },
  { id: 'conversation', label: 'Conversación' },
  { id: 'valuation_scheduled', label: 'Valoración programada' },
  { id: 'valuation_completed', label: 'Valoración realizada' },
  { id: 'treatment_proposed', label: 'Tratamiento propuesto' },
  { id: 'treatment_scheduled', label: 'Tratamiento programado' },
  { id: 'treatment_completed', label: 'Tratamiento realizado' },
  { id: 'control_scheduled', label: '1er control programado' },
  { id: 'client_completed', label: 'Cliente nuevo · ciclo completado' },
  { id: 'lost', label: 'Perdido' },
] as const

export type CanonicalPipelineStage = (typeof PIPELINE_STAGES)[number]['id']

const PIPELINE_STAGE_IDS = new Set<string>(PIPELINE_STAGES.map((stage) => stage.id))

const APPOINTMENT_EVIDENCE_STAGE_IDS = new Set<string>([
  'valuation_scheduled',
  'valuation_completed',
  'treatment_scheduled',
  'treatment_completed',
  'control_scheduled',
  'client_completed',
])

const CLINICAL_STAGE_IDS = new Set<string>([
  'valuation_scheduled',
  'valuation_completed',
  'treatment_proposed',
  'treatment_scheduled',
  'treatment_completed',
  'control_scheduled',
  'client_completed',
])

const NEW_CLIENT_STAGE_IDS = new Set<string>([
  'control_scheduled',
  'client_completed',
])

export function isCanonicalPipelineStage(value: unknown): value is CanonicalPipelineStage {
  return typeof value === 'string' && PIPELINE_STAGE_IDS.has(value)
}

export function pipelineStageLabel(value: string | null | undefined): string {
  return PIPELINE_STAGES.find((stage) => stage.id === value)?.label ?? value ?? 'Sin etapa'
}

export function hasCanonicalAppointmentEvidence(value: string | null | undefined): boolean {
  return typeof value === 'string' && APPOINTMENT_EVIDENCE_STAGE_IDS.has(value)
}

export function isClinicalPipelineStage(value: string | null | undefined): boolean {
  return typeof value === 'string' && CLINICAL_STAGE_IDS.has(value)
}

export function isNewClientPipelineStage(value: string | null | undefined): boolean {
  return typeof value === 'string' && NEW_CLIENT_STAGE_IDS.has(value)
}
