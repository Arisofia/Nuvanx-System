-- Migration: Add pre-computed template_phone column to financial_settlements
-- and recreate vw_lead_traceability using indexed column lookup instead of regex in WHERE.
-- This replaces migration 20260506140000 which caused FGA timeouts due to regex scanning.

-- Step 1: Add indexed template_phone column to financial_settlements
ALTER TABLE financial_settlements ADD COLUMN IF NOT EXISTS template_phone VARCHAR(16);

UPDATE financial_settlements
SET template_phone = (regexp_match(template_name, '\[([0-9]{9,15})\]'))[1]
WHERE template_phone IS NULL;

CREATE INDEX IF NOT EXISTS settlements_template_phone_idx
  ON financial_settlements (template_phone)
  WHERE template_phone IS NOT NULL;

-- Step 2: Recreate view using indexed column (no regex in JOIN WHERE clause)
DROP VIEW IF EXISTS public.vw_lead_traceability;

CREATE VIEW public.vw_lead_traceability AS
SELECT
  l.id AS lead_id,
  l.name AS lead_name,
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
  l.created_at AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue AS estimated_revenue,
  l.verified_revenue AS crm_verified_revenue,
  l.lost_reason,
  p.id AS patient_id,
  p.total_ltv AS patient_ltv,
  fs.id AS settlement_id,
  fs.template_id AS doctoralia_template_id,
  fs.template_name AS doctoralia_template_name,
  fs.amount_net AS doctoralia_net,
  fs.amount_gross AS doctoralia_gross,
  fs.settled_at AS settlement_date,
  fs.intake_at AS settlement_intake_date,
  fs.source_system AS settlement_source,
  l.user_id AS lead_user_id,
  p.name AS patient_name,
  p.dni AS patient_dni,
  p.phone AS patient_phone,
  p.last_visit AS patient_last_visit,
  dp.doc_patient_id,
  dp.match_confidence,
  dp.match_class,
  fs_first.settled_at AS first_settlement_at
FROM leads l
LEFT JOIN users u ON u.id = l.user_id
LEFT JOIN patients p
  ON (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
  OR p.id = l.converted_patient_id
LEFT JOIN LATERAL (
  SELECT
    sub_dp.doc_patient_id,
    sub_dp.match_confidence,
    CASE WHEN sub_dp.lead_id = l.id
         THEN sub_dp.match_class
         ELSE 'exact_phone' END AS match_class
  FROM doctoralia_patients sub_dp
  WHERE (sub_dp.lead_id = l.id)
    OR (
      u.clinic_id IS NOT NULL
      AND sub_dp.clinic_id = u.clinic_id
      AND sub_dp.phone_primary IS NOT NULL
      AND l.phone_normalized IS NOT NULL
      AND RIGHT(regexp_replace(sub_dp.phone_primary, '[^0-9]', '', 'g'), 9)
          = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
    )
  ORDER BY sub_dp.match_confidence DESC NULLS LAST
  LIMIT 1
) dp ON TRUE
LEFT JOIN LATERAL (
  SELECT
    id,
    template_id,
    template_name,
    amount_net,
    amount_gross,
    settled_at,
    intake_at,
    source_system
  FROM financial_settlements sub_fs
  WHERE sub_fs.cancelled_at IS NULL
    AND (
      (p.id IS NOT NULL AND sub_fs.patient_id = p.id)
      OR (
        u.clinic_id IS NOT NULL
        AND sub_fs.clinic_id = u.clinic_id
        AND l.phone_normalized IS NOT NULL
        AND l.phone_normalized <> ''
        AND sub_fs.template_phone IS NOT NULL
        AND sub_fs.template_phone = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
      )
    )
  ORDER BY sub_fs.settled_at DESC
  LIMIT 1
) fs ON TRUE
LEFT JOIN LATERAL (
  SELECT settled_at
  FROM financial_settlements sub_fs2
  WHERE sub_fs2.cancelled_at IS NULL
    AND (
      (p.id IS NOT NULL AND sub_fs2.patient_id = p.id)
      OR (
        u.clinic_id IS NOT NULL
        AND sub_fs2.clinic_id = u.clinic_id
        AND l.phone_normalized IS NOT NULL
        AND l.phone_normalized <> ''
        AND sub_fs2.template_phone IS NOT NULL
        AND sub_fs2.template_phone = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
      )
    )
  ORDER BY sub_fs2.settled_at ASC
  LIMIT 1
) fs_first ON TRUE;

ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);
