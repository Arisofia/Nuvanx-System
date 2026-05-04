// ─────────────────────────────────────────────────────────────────────────────
// Nuvanx — Centralised TypeScript types
// Import from this file rather than defining interfaces in individual pages.
// ─────────────────────────────────────────────────────────────────────────────

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardMetrics {
  totalLeads: number
  conversionRate: number
  activeCampaigns: number
  spend: number
  averageCpc: number
  metaConversions: number
  verifiedRevenue?: number
  totalRevenue?: number
  settledCount?: number
  deltas?: {
    leads: number
    revenue: number
    spend: number
    conversions: number
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
  avgLiquidationDays: number
  settledCount: number
  cancelledCount: number
}

export interface MonthlyTrend {
  month: string
  net: number
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

export type LeadStage = 'lead' | 'whatsapp' | 'appointment' | 'treatment' | 'closed'

export interface Lead {
  id: string
  name: string
  status: LeadStage | string
  source: string
  email?: string
  phone?: string
  dni?: string
  notes?: string
  revenue?: number
  created_at?: string
  updated_at?: string
}

// ── Integrations ──────────────────────────────────────────────────────────────

export type IntegrationRow = {
  id: string
  service: string
  status: string | null
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
  phoneNumberId: string
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

// ── Live ──────────────────────────────────────────────────────────────────────

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
