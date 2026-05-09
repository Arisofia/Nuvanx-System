-- =============================================================================
-- Fix vw_lead_traceability: add phone-based matching paths and fix type conflict
--
-- PROBLEMS FIXED:
--   1. "Cruzados con Doctoralia" = 0:
--      doctoralia_patients.lead_id was only set by run_doctoralia_name_match().
--      That function was never run. Now also matches by phone_primary.
--
--   2. "Con ingresos verificados" = 0:
--      financial_settlements.patient_id is always NULL (sync script doesn't set it).
--      The view's JOIN via patient_id = p.id always returned empty.
--      Now also matches by phone extracted from template_name "[phone]" brackets.
--
--   3. clinic_id context:
--      Added LEFT JOIN users to provide u.clinic_id for scoping phone-based joins.
--
--   4. Data Type Error (SQLSTATE 42P16):
--      Recreating a view with CREATE OR REPLACE fails if a column's data type
--      changes (e.g., from VARCHAR(32) to unlimited VARCHAR/TEXT).
--      We DROP the view first to ensure the new types are accepted.
-- =============================================================================

DROP VIEW IF EXISTS public.vw_lead_traceability;

CREATE OR REPLACE VIEW public.vw_lead_traceability AS
SELECT
  -- ── lead (existing columns, unchanged order) ─────────────────────────────
  l.id                    AS lead_id,
  l.name                  AS lead_name,
  l.email_normalized,
  l.phone_normalized,
  l.source,
  l.stage,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  l.ad_id,
  l.ad_name,
  l.form_id,
  l.form_name,
  l.created_at            AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue               AS estimated_revenue,
  l.verified_revenue      AS crm_verified_revenue,
  l.lost_reason,
  -- ── patient (existing) ───────────────────────────────────────────────────
  p.id                    AS patient_id,
  p.total_ltv             AS patient_ltv,
  -- ── most-recent settlement ───────────────────────────────────────────────
  fs.id                   AS settlement_id,
  fs.template_id          AS doctoralia_template_id,
  fs.template_name        AS doctoralia_template_name,
  fs.amount_net           AS doctoralia_net,
  fs.amount_gross         AS doctoralia_gross,
  fs.settled_at           AS settlement_date,
  fs.intake_at            AS settlement_intake_date,
  fs.source_system        AS settlement_source,
  -- ── user_id for API-level row scoping ────────────────────────────────────
  l.user_id               AS lead_user_id,
  -- ── patient details ──────────────────────────────────────────────────────
  p.name                  AS patient_name,
  p.dni                   AS patient_dni,
  p.phone                 AS patient_phone,
  p.last_visit            AS patient_last_visit,
  -- ── Doctoralia match quality (best match per lead) ───────────────────────
  dp.doc_patient_id,
  dp.match_confidence,
  dp.match_class::VARCHAR(32) AS match_class,
  -- ── first (oldest) non-cancelled settlement date ─────────────────────────
  fs_first.settled_at     AS first_settlement_at

FROM public.leads l

-- clinic_id needed for phone-based scoped joins
LEFT JOIN public.users u ON u.id = l.user_id

LEFT JOIN public.patients p
  ON  (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
  OR   p.id = l.converted_patient_id

-- Best Doctoralia patient match:
--   Primary:   lead_id match (set by run_doctoralia_name_match function)
--   Fallback:  phone_primary exact match (last 9 digits, handles country code variance)
LEFT JOIN LATERAL (
  SELECT
    sub_dp.doc_patient_id,
    sub_dp.match_confidence,
    (CASE
      WHEN sub_dp.lead_id = l.id THEN sub_dp.match_class
      ELSE 'exact_phone'
    END)::VARCHAR(32) AS match_class
  FROM   public.doctoralia_patients sub_dp
  WHERE  (sub_dp.lead_id = l.id)
    OR   (
           u.clinic_id IS NOT NULL
           AND sub_dp.clinic_id = u.clinic_id
           AND sub_dp.phone_primary IS NOT NULL
           AND l.phone_normalized  IS NOT NULL
           AND RIGHT(regexp_replace(sub_dp.phone_primary,    '[^0-9]', '', 'g'), 9)
             = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
         )
  ORDER  BY sub_dp.match_confidence DESC NULLS LAST
  LIMIT  1
) dp ON TRUE

-- Most-recent non-cancelled settlement:
--   Path 1: via CRM patients (when patient_id is populated — legacy path)
--   Path 2: phone match from template_name "[phone]"
--            template_name format: "<docId>. <NAME> [<phone>] (<treatment>)"
LEFT JOIN LATERAL (
  SELECT id, template_id, template_name, amount_net, amount_gross,
         settled_at, intake_at, source_system
  FROM   public.financial_settlements sub_fs
  WHERE  sub_fs.cancelled_at IS NULL
    AND  (
           -- Legacy: CRM patient FK
           (p.id IS NOT NULL AND sub_fs.patient_id = p.id)
           OR
           -- Phone: extract phone from template_name brackets, compare last 9 digits
           (
             u.clinic_id IS NOT NULL
             AND sub_fs.clinic_id = u.clinic_id
             AND l.phone_normalized IS NOT NULL
             AND l.phone_normalized <> ''
             AND RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               = RIGHT((regexp_match(sub_fs.template_name, '\[([0-9]{9,15})\]'))[1], 9)
           )
         )
  ORDER  BY sub_fs.settled_at DESC
  LIMIT  1
) fs ON TRUE

-- Oldest non-cancelled settlement (for first_settlement_at)
LEFT JOIN LATERAL (
  SELECT settled_at
  FROM   public.financial_settlements sub_fs2
  WHERE  sub_fs2.cancelled_at IS NULL
    AND  (
           (p.id IS NOT NULL AND sub_fs2.patient_id = p.id)
           OR
           (
             u.clinic_id IS NOT NULL
             AND sub_fs2.clinic_id = u.clinic_id
             AND l.phone_normalized IS NOT NULL
             AND l.phone_normalized <> ''
             AND RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               = RIGHT((regexp_match(sub_fs2.template_name, '\[([0-9]{9,15})\]'))[1], 9)
           )
         )
  ORDER  BY sub_fs2.settled_at ASC
  LIMIT  1
) fs_first ON TRUE;

-- Re-apply security_invoker (CREATE OR REPLACE VIEW resets view options)
ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);
