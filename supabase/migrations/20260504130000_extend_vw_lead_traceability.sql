-- =============================================================================
-- Extend vw_lead_traceability with:
--   - lead_user_id      (for server-side user scoping in the API handler)
--   - patient_name, patient_dni, patient_phone, patient_last_visit
--   - doc_patient_id, match_confidence, match_class  (from doctoralia_patients)
--   - first_settlement_at  (oldest non-cancelled settlement per patient)
-- All existing columns are preserved in their original order.
-- =============================================================================

CREATE OR REPLACE VIEW vw_lead_traceability AS
SELECT
  -- ── lead (existing columns, unchanged order) ──────────────────────────────
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
  -- ── most-recent settlement (existing, via LATERAL DESC) ──────────────────
  fs.id                   AS settlement_id,
  fs.template_id          AS doctoralia_template_id,
  fs.template_name        AS doctoralia_template_name,
  fs.amount_net           AS doctoralia_net,
  fs.amount_gross         AS doctoralia_gross,
  fs.settled_at           AS settlement_date,
  fs.intake_at            AS settlement_intake_date,
  fs.source_system        AS settlement_source,
  -- ── NEW: user_id for API-level row scoping ────────────────────────────────
  l.user_id               AS lead_user_id,
  -- ── NEW: patient details ─────────────────────────────────────────────────
  p.name                  AS patient_name,
  p.dni                   AS patient_dni,
  p.phone                 AS patient_phone,
  p.last_visit            AS patient_last_visit,
  -- ── NEW: Doctoralia match quality (best match per lead) ──────────────────
  dp.doc_patient_id,
  dp.match_confidence,
  dp.match_class,
  -- ── NEW: first (oldest) non-cancelled settlement date ────────────────────
  fs_first.settled_at     AS first_settlement_at

FROM leads l

LEFT JOIN patients p
  ON  (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
  OR   p.id = l.converted_patient_id

-- Best Doctoralia patient match for this lead (highest confidence, LIMIT 1)
LEFT JOIN LATERAL (
  SELECT doc_patient_id, match_confidence, match_class
  FROM   doctoralia_patients sub_dp
  WHERE  sub_dp.lead_id = l.id
  ORDER  BY sub_dp.match_confidence DESC NULLS LAST
  LIMIT  1
) dp ON TRUE

-- Most-recent non-cancelled settlement (existing behaviour)
LEFT JOIN LATERAL (
  SELECT id, template_id, template_name, amount_net, amount_gross,
         settled_at, intake_at, source_system
  FROM   financial_settlements sub_fs
  WHERE  sub_fs.patient_id = p.id
    AND  sub_fs.cancelled_at IS NULL
  ORDER  BY sub_fs.settled_at DESC
  LIMIT  1
) fs ON TRUE

-- Oldest non-cancelled settlement (for first_settlement_at)
LEFT JOIN LATERAL (
  SELECT settled_at
  FROM   financial_settlements sub_fs2
  WHERE  sub_fs2.patient_id = p.id
    AND  sub_fs2.cancelled_at IS NULL
  ORDER  BY sub_fs2.settled_at ASC
  LIMIT  1
) fs_first ON TRUE;
