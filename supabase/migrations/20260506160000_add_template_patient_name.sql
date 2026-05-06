-- Migration: add template_patient_name column to financial_settlements
-- and recreate vw_lead_traceability with name-based matching path.
-- Executed: 2026-05-06

-- 1. Add column
ALTER TABLE financial_settlements
  ADD COLUMN IF NOT EXISTS template_patient_name TEXT;

-- 2. Populate from template_name: extract name before the phone bracket
--    e.g. "388. Sara Beatriz Ramirez Reyes [603338197] (ENDOLIFT ABDOMEN)" → "Sara Beatriz Ramirez Reyes"
UPDATE financial_settlements
SET template_patient_name = TRIM(regexp_replace(
  regexp_replace(template_name, E'^\\d+\\.\\s*', ''),  -- remove leading "388. "
  E'\\s*\\[.*$', ''                                     -- remove " [phone] (treatment)"
))
WHERE template_patient_name IS NULL;

-- 3. Index for fast ILIKE prefix lookups
CREATE INDEX IF NOT EXISTS settlements_template_patient_name_idx
  ON financial_settlements (template_patient_name)
  WHERE template_patient_name IS NOT NULL;

-- 4. Recreate view with name-based LATERAL join path
DROP VIEW IF EXISTS public.vw_lead_traceability;

CREATE VIEW public.vw_lead_traceability AS
SELECT
  l.id                        AS lead_id,
  l.name                      AS lead_name,
  l.email_normalized,
  l.phone_normalized,
  l.user_id                   AS lead_user_id,
  l.source,
  l.campaign_name,
  l.adset_name,
  l.ad_name,
  l.created_at                AS lead_created_at,

  p.id                        AS patient_id,
  p.name                      AS patient_name,
  p.dni                       AS patient_dni,
  p.phone                     AS patient_phone,
  p.last_visit                AS patient_last_visit,
  p.ltv                       AS patient_ltv,

  dp.doc_patient_id,
  dp.match_confidence,
  dp.match_class,

  fs.settled_at               AS settlement_date,
  fs_first.settled_at         AS first_settlement_at,
  fs.amount_net               AS doctoralia_net,
  fs.template_name            AS doctoralia_template_name

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
         ELSE 'exact_phone'
    END AS match_class
  FROM doctoralia_patients sub_dp
  WHERE (sub_dp.lead_id = l.id)
     OR (u.clinic_id IS NOT NULL
         AND sub_dp.clinic_id = u.clinic_id
         AND RIGHT(regexp_replace(sub_dp.phone_primary, '[^0-9]', '', 'g'), 9)
           = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9))
  ORDER BY sub_dp.match_confidence DESC NULLS LAST
  LIMIT 1
) dp ON TRUE
LEFT JOIN LATERAL (
  SELECT id, template_id, template_name, amount_net, amount_gross,
         settled_at, intake_at, source_system
  FROM financial_settlements sub_fs
  WHERE sub_fs.cancelled_at IS NULL
    AND u.clinic_id IS NOT NULL
    AND sub_fs.clinic_id = u.clinic_id
    AND (
      (p.id IS NOT NULL AND sub_fs.patient_id = p.id)
      OR (l.phone_normalized IS NOT NULL
          AND l.phone_normalized <> ''
          AND sub_fs.template_phone IS NOT NULL
          AND sub_fs.template_phone = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9))
      OR (l.name_normalized IS NOT NULL
          AND l.name_normalized <> ''
          AND sub_fs.template_patient_name IS NOT NULL
          AND sub_fs.template_patient_name ILIKE l.name_normalized || '%')
    )
  ORDER BY sub_fs.settled_at DESC
  LIMIT 1
) fs ON TRUE
LEFT JOIN LATERAL (
  SELECT settled_at
  FROM financial_settlements sub_fs2
  WHERE sub_fs2.cancelled_at IS NULL
    AND u.clinic_id IS NOT NULL
    AND sub_fs2.clinic_id = u.clinic_id
    AND (
      (p.id IS NOT NULL AND sub_fs2.patient_id = p.id)
      OR (l.phone_normalized IS NOT NULL
          AND l.phone_normalized <> ''
          AND sub_fs2.template_phone IS NOT NULL
          AND sub_fs2.template_phone = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9))
      OR (l.name_normalized IS NOT NULL
          AND l.name_normalized <> ''
          AND sub_fs2.template_patient_name IS NOT NULL
          AND sub_fs2.template_patient_name ILIKE l.name_normalized || '%')
    )
  ORDER BY sub_fs2.settled_at ASC
  LIMIT 1
) fs_first ON TRUE;

ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);
