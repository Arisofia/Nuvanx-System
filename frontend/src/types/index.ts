// ─────────────────────────────────────────────────────────────────────────────
// Nuvanx — Centralised TypeScript types
// Import from this file rather than defining interfaces in individual pages.
// ─────────────────────────────────────────────────────────────────────────────

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardMetrics {
  totalLeads: number | null
  conversionRate: number | null
  patientMatches?: number | null
  patientConversionRate?: number | null
  activeCampaigns: number | null
  spend: number | null
  averageCpc: number | null
  metaConversions: number | null
  metaLeadGen?: number | null
  metaWhatsapp?: number | null
  metaOther?: number | null
  verifiedRevenue?: number | null
  totalRevenue?: number | null
  settledCount?: number | null
  deltas?: {
    leads: number | null
    revenue: number | null
    spend: number | null
    conversions: number | null
    patientMatches?: number | null
  }
  loading: boolean
  error: string | null
  metaError: string | null
}

export interface MetaTrendPoint {
  week: string
  value: number
}

export interface ActivityEvent {
  id: string
  label: string
  detail: string
  ts: string
}

// ── Marketing / Meta Ads ──────────────────────────────────────────────────────

export interface CampaignInsights {
  impressions: number
  reach: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
  conversions: number
  cpp: number | null
}

export interface CampaignRow {
  id: string
  name: string
  status: string
  objective: string
  accountId?: string | null
  dailyBudget: number | null
  lifetimeBudget: number | null
  source: string
  insights: CampaignInsights | null
}

export interface AccountSummary {
  impressions: number
  reach: number
  clicks: number
  spend: number
  conversions: number
  messagingConversationStarted: number
  ctr: number
  cpc: number
  cpm: number
  cpp: number
}

export interface DailyPoint {
  date: string
  impressions: number
  reach: number
  clicks: number
  spend: number
  ctr: number
  cpc: number
  cpm: number
  messagingConversationStarted: number
}

export interface MetaChanges {
  impressions: number
  reach: number
  clicks: number
  spend: number
  conversions: number
}

export interface MarketingState {
  summary: AccountSummary | null
  changes: MetaChanges | null
  daily: DailyPoint[]
  campaigns: CampaignRow[]
  currency: string
  accountId: string
  accountIds: string[]
  period: { since: string; until: string; days: number } | null
  loading: boolean
  error: string | null
}

// ── Financials ────────────────────────────────────────────────────────────────

export interface FinancialSummary {
  totalNet: number
  totalGross: number
  totalDiscount: number
  avgTicket: number
  discountRate: number
  cancellationRate: number
  avgLiquidationDays: number
  settledCount: number
  cancelledCount: number
  operationsCount: number
}

export interface MonthlyTrend {
  month: string
  net: number
  gross?: number
  discount?: number
  count?: number
}

export interface TemplateMixRow {
  name: string
  count: number
  net: number
  pct: number
}

export interface FinancialsState {
  summary: FinancialSummary | null
  monthly: MonthlyTrend[]
  templateMix: TemplateMixRow[]
  loading: boolean
  error: string | null
}

// ── CRM ───────────────────────────────────────────────────────────────────────

/**
 * Legacy five-column DnD board type. The active CRM does not use this as
 * commercial truth; it remains only for compatibility with old components.
 */
export type LeadStage = 'lead' | 'whatsapp' | 'appointment' | 'treatment' | 'closed'

/** Canonical evidence-first pipeline returned by vw_control_centre_pipeline. */
export type CanonicalStage =
  | 'new_lead'
  | 'contacted'
  | 'conversation'
  | 'valuation_scheduled'
  | 'valuation_completed'
  | 'treatment_proposed'
  | 'treatment_scheduled'
  | 'treatment_completed'
  | 'control_scheduled'
  | 'client_completed'
  | 'lost'

/** An appointment match from lead_appointment_matches joined via the API. */
export interface AppointmentMatch {
  appointment_ingestion_id: string
  match_method: string
  is_primary: boolean
  appointment_date?: string | null
}

export interface Lead {
  id: string
  name: string
  /** Canonical evidence-first pipeline stage in the active CRM. */
  status: string
  /** Raw legacy leads.stage value, debug only. */
  stage_raw?: string
  /** Legacy leads.stage_canonical value, debug only; not the Control Centre pipeline. */
  stage_canonical?: string | null
  source: string
  email?: string
  phone?: string
  dni?: string
  notes?: string
  revenue?: number
  verified_revenue?: number
  appointment_date?: string
  treatment_name?: string
  created_at?: string
  updated_at?: string
  appointment_matches?: AppointmentMatch[]
  pipeline_stage_source?: 'evidence' | 'explicit'
  journey_appointment_count?: number
  valuation_appointment_date?: string | null
  treatment_appointment_date?: string | null
  first_control_appointment_date?: string | null
  is_new_client?: boolean
  client_completed_at?: string | null
  journey_identity_source?: 'doctoralia_id' | 'phone_normalized' | null
}

// ── Integrations ──────────────────────────────────────────────────────────────

/**
 * Health status computed on the frontend from the raw integration row.
 * - 'ok':          connected + last_sync confirmed
 * - 'degraded':    status is connected/active but runtime evidence missing
 *                  (null last_sync, missing service-account env, etc.)
 * - 'disconnected': any other status value
 */
export type IntegrationHealthStatus = 'ok' | 'degraded' | 'disconnected'

export type IntegrationRow = {
  id: string
  service: string
  status: string | null
  last_sync?: string | null
  last_error: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
  [key: string]: unknown
}

export interface ConnectForm {
  service: string
  token: string
  adAccountId: string
  pageId: string
  pixelId?: string
  phoneNumberId: string
  googleAdsCustomerId?: string
}

// ── Intelligence ──────────────────────────────────────────────────────────────

export interface FunnelRow {
  stage: string
  count: number
  pct?: number
}

export interface CampaignPerformance {
  source: string
  campaign_name?: string
  campaign_id?: string
  total_leads: number
  contacted?: number
  replied?: number
  booked?: number
  attended?: number
  no_shows?: number
  closed?: number
  closed_won?: number
  estimated_revenue?: number
  verified_revenue_crm?: number
  reply_rate_pct?: number
  lead_to_close_rate_pct?: number
  no_show_rate_pct?: number
  avg_reply_delay_min?: number
  pct?: number
}

export interface Conversation {
  id: string
  phone?: string
  direction: string
  message_preview?: string
  sent_at?: string
}

export interface TraceabilityLead {
  lead_id: string
  lead_name?: string
  source?: string
  campaign_name?: string
  lead_created_at: string
  patient_id?: string
  patient_name?: string
  patient_dni?: string
  patient_phone?: string
  patient_last_visit?: string
  patient_ltv?: number
  doc_patient_id?: string
  match_confidence?: number
  match_class?: string
  settlement_date?: string
  first_settlement_at?: string
  doctoralia_net?: number
  doctoralia_template_name?: string
}

// ── Live ──────────────────────────────────────────────────────────────────────

export interface DoctoraliaAppointment {
  raw_hash: string
  paciente_nombre: string | null
  hora: string | null
  estado: string | null
  asunto: string | null
  agenda: string | null
  sala_box: string | null
  procedencia: string | null
  importe: number | null
  confirmada: boolean
  timestamp_cita: string | null
  doc_patient_id: string | null
  // Campaign match
  lead_id: string | null
  campaign_name: string | null
  match_class: string | null
  match_confidence: number | null
}

export interface LiveEvent {
  id: string
  type: string
  label: string
  detail?: string
  ts: string
}

// ── Playbooks ─────────────────────────────────────────────────────────────────

export interface Playbook {
  id: string
  slug: string
  title: string
  name: string
  description?: string
  category?: string
  status: string
  steps: string[]
  runs: number
  lastRunAt?: string | null
}

export interface RunResult {
  playbookId: string
  loading: boolean
  result: string | null
  error: string | null
}
