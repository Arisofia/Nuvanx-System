-- =============================================================================
-- Extend vw_lead_traceability with:
--   - lead_user_id      (for server-side user scoping in the API handler)
--   - patient_name, patient_dni, patient_phone, patient_last_visit
--   - doc_patient_id, match_confidence, match_class  (from doctoralia_patients)
--   - first_settlement_at  (oldest non-cancelled settlement per patient)
-- All existing columns are preserved in their original order.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE NOTICE 'Skipping vw_lead_traceability refresh: public.leads does not exist';
    RETURN;
  END IF;

  EXECUTE $sql$
CREATE OR REPLACE VIEW public.vw_lead_traceability AS
SELECT
  -- ── lead (existing columns, unchanged order) ──────────────────────────────
  l.id                    AS lead_id,
  l.name                  AS lead_name,
  l.email_normalized,
  l.phone_normalized,
  NULL::TEXT              AS source,
  NULL::TEXT              AS stage,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  l.ad_id,
  l.ad_name,
  l.form_id,
  l.form_name,
  NULL::TIMESTAMPTZ       AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue               AS estimated_revenue,
  l.verified_revenue      AS crm_verified_revenue,
  l.lost_reason,
  -- ── patient placeholders; later migrations replace this view with joins ───
  NULL::UUID              AS patient_id,
  NULL::NUMERIC           AS patient_ltv,
  -- ── most-recent settlement placeholders ──────────────────────────────────
  NULL::TEXT              AS settlement_id,
  NULL::TEXT              AS doctoralia_template_id,
  NULL::TEXT              AS doctoralia_template_name,
  NULL::NUMERIC           AS doctoralia_net,
  NULL::NUMERIC           AS doctoralia_gross,
  NULL::TIMESTAMPTZ       AS settlement_date,
  NULL::TIMESTAMPTZ       AS settlement_intake_date,
  NULL::TEXT              AS settlement_source,
  -- ── user_id for API-level row scoping ────────────────────────────────────
  l.user_id               AS lead_user_id,
  -- ── patient details placeholders ─────────────────────────────────────────
  NULL::TEXT              AS patient_name,
  NULL::TEXT              AS patient_dni,
  NULL::VARCHAR(64)       AS patient_phone,
  NULL::TIMESTAMPTZ       AS patient_last_visit,
  -- ── Doctoralia match quality placeholders ────────────────────────────────
  NULL::TEXT              AS doc_patient_id,
  NULL::NUMERIC           AS match_confidence,
  NULL::VARCHAR(32)       AS match_class,
  -- ── first settlement placeholder ─────────────────────────────────────────
  NULL::TIMESTAMPTZ       AS first_settlement_at
FROM public.leads l;

ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);
GRANT SELECT ON public.vw_lead_traceability TO authenticated;
GRANT SELECT ON public.vw_lead_traceability TO service_role;
  $sql$;
END $$;
