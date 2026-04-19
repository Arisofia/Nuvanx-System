-- =============================================================================
-- Query Performance Indexes — April 19, 2026
--
-- Fills gaps left after the advisor-driven index cleanup in 20260419150000:
--   • leads_stage_idx and leads_user_id_idx were dropped as "unused" but the
--     queries that need them were replaced by better composite indexes below.
--   • audit_log_resource_idx was dropped but resource-type queries still run.
--   • Several high-traffic query patterns (sorted lists, partial lookups) had
--     no supporting index at all.
-- =============================================================================

-- ─── leads ────────────────────────────────────────────────────────────────────

-- findByUser always orders by created_at DESC; most common query path.
-- Covers: WHERE user_id = $1 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS leads_user_created_idx
  ON public.leads (user_id, created_at DESC);

-- Stage-filtered list (CRM pipeline view).
-- Covers: WHERE user_id = $1 AND stage = $2 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS leads_user_stage_created_idx
  ON public.leads (user_id, stage, created_at DESC);

-- findOrMerge email dedup path.
-- Covers: WHERE user_id = $1 AND LOWER(email) = $2
CREATE INDEX IF NOT EXISTS leads_user_email_lower_idx
  ON public.leads (user_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- Dashboard KPI counts: contacted and replied leads.
-- Covers: WHERE user_id = $1 AND first_outbound_at IS NOT NULL
CREATE INDEX IF NOT EXISTS leads_user_first_outbound_idx
  ON public.leads (user_id, first_outbound_at)
  WHERE first_outbound_at IS NOT NULL;

-- Covers: WHERE user_id = $1 AND first_inbound_at IS NOT NULL
CREATE INDEX IF NOT EXISTS leads_user_first_inbound_idx
  ON public.leads (user_id, first_inbound_at)
  WHERE first_inbound_at IS NOT NULL;

-- ─── audit_log ────────────────────────────────────────────────────────────────

-- Restore the resource-type lookup dropped by 20260419150000.
-- Covers: WHERE resource_type = $1 AND resource_id = $2
CREATE INDEX IF NOT EXISTS audit_log_resource_type_id_idx
  ON public.audit_log (resource_type, resource_id);

-- ─── whatsapp_conversations ───────────────────────────────────────────────────

-- Conversation list is always ordered by sent_at DESC within a clinic.
-- Covers: WHERE clinic_id = $1 ORDER BY sent_at DESC
CREATE INDEX IF NOT EXISTS whatsapp_conversations_clinic_sent_idx
  ON public.whatsapp_conversations (clinic_id, sent_at DESC);

-- ─── financial_settlements ────────────────────────────────────────────────────

-- LATERAL join in traceability/leads: most recent non-cancelled settlement
-- per patient.
-- Covers: WHERE patient_id = $1 AND cancelled_at IS NULL ORDER BY settled_at DESC
CREATE INDEX IF NOT EXISTS settlements_patient_settled_active_idx
  ON public.financial_settlements (patient_id, settled_at DESC)
  WHERE cancelled_at IS NULL;

-- ─── patients ─────────────────────────────────────────────────────────────────

-- Patient list ordered by lifetime value.
-- Covers: WHERE clinic_id = $1 ORDER BY total_ltv DESC
CREATE INDEX IF NOT EXISTS patients_clinic_ltv_idx
  ON public.patients (clinic_id, total_ltv DESC);

-- ─── Statistics ───────────────────────────────────────────────────────────────
ANALYZE public.leads;
ANALYZE public.audit_log;
ANALYZE public.whatsapp_conversations;
ANALYZE public.financial_settlements;
ANALYZE public.patients;
