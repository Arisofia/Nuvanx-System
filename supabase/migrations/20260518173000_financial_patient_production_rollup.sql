-- Financial patient production rollup
--
-- The financial_settlements.patient_name field is often NULL, and exact joins to
-- patients can fail when phone formats diverge. This view makes patient-level
-- production auditable by using a deterministic fallback chain:
--   1) settlement.patient_id
--   2) clinic-scoped 9-digit phone match to public.patients
--   3) normalized settlement phone
--   4) non-null settlement patient_name
--   5) individual settlement id

BEGIN;

CREATE INDEX IF NOT EXISTS idx_financial_settlements_clinic_phone_any
  ON public.financial_settlements (clinic_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone_normalized_any
  ON public.patients (clinic_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE OR REPLACE VIEW public.vw_financial_patient_production
WITH (security_invoker = true) AS
WITH settlement_base AS (
  SELECT
    fs.id,
    fs.clinic_id,
    fs.patient_id AS settlement_patient_id,
    NULLIF(btrim(fs.patient_name), '') AS settlement_patient_name,
    NULLIF(
      RIGHT(
        regexp_replace(
          COALESCE(NULLIF(fs.phone_normalized, ''), NULLIF(fs.patient_phone, '')),
          '[^0-9]',
          '',
          'g'
        ),
        9
      ),
      ''
    ) AS settlement_phone_key,
    NULLIF(
      btrim(
        regexp_replace(
          regexp_replace(COALESCE(fs.template_name, ''), '^\s*\d+\.\s*', ''),
          '\s*\[[^\]]+\].*$',
          ''
        )
      ),
      ''
    ) AS parsed_template_patient_name,
    COALESCE(fs.amount_net, 0)::NUMERIC AS amount_net,
    COALESCE(fs.intake_at, fs.settled_at, fs.created_at) AS event_at,
    fs.cancelled_at
  FROM public.financial_settlements fs
  WHERE fs.cancelled_at IS NULL
),
patient_phone_lookup AS (
  SELECT DISTINCT ON (p.clinic_id, phone_key)
    p.clinic_id,
    p.id,
    p.name,
    phone_key
  FROM public.patients p
  CROSS JOIN LATERAL (
    SELECT NULLIF(RIGHT(regexp_replace(COALESCE(p.phone_normalized, p.phone), '[^0-9]', '', 'g'), 9), '') AS phone_key
  ) normalized
  WHERE phone_key IS NOT NULL
  ORDER BY p.clinic_id, phone_key, p.created_at DESC NULLS LAST, p.id
),
settlement_enriched AS (
  SELECT
    sb.*,
    COALESCE(pid.id, pphone.id) AS matched_patient_id,
    COALESCE(pid.name, pphone.name) AS matched_patient_name
  FROM settlement_base sb
  LEFT JOIN public.patients pid
    ON pid.clinic_id = sb.clinic_id
   AND pid.id = sb.settlement_patient_id
  LEFT JOIN patient_phone_lookup pphone
    ON pphone.clinic_id = sb.clinic_id
   AND pphone.phone_key = sb.settlement_phone_key
)
SELECT
  se.clinic_id,
  COALESCE(
    se.matched_patient_id::TEXT,
    se.settlement_patient_id::TEXT,
    'phone:' || se.settlement_phone_key,
    'name:' || lower(se.settlement_patient_name),
    'settlement:' || se.id::TEXT
  ) AS patient_key,
  COALESCE(se.matched_patient_id, se.settlement_patient_id) AS patient_id,
  COALESCE(
    NULLIF(btrim(se.matched_patient_name), ''),
    se.settlement_patient_name,
    se.parsed_template_patient_name,
    CASE WHEN se.settlement_phone_key IS NOT NULL THEN 'Tel. ' || se.settlement_phone_key END,
    'Paciente sin identificar'
  ) AS patient_name,
  se.settlement_phone_key AS phone_normalized,
  COUNT(*)::BIGINT AS registros,
  ROUND(SUM(se.amount_net), 2) AS total_neto,
  MIN(se.event_at) AS first_settlement_at,
  MAX(se.event_at) AS last_settlement_at,
  CASE
    WHEN se.matched_patient_id IS NOT NULL THEN 'patients'
    WHEN se.settlement_patient_id IS NOT NULL THEN 'settlement_patient_id'
    WHEN se.settlement_phone_key IS NOT NULL THEN 'settlement_phone'
    WHEN se.settlement_patient_name IS NOT NULL THEN 'settlement_patient_name'
    ELSE 'unidentified_settlement'
  END AS match_source
FROM settlement_enriched se
GROUP BY
  se.clinic_id,
  COALESCE(
    se.matched_patient_id::TEXT,
    se.settlement_patient_id::TEXT,
    'phone:' || se.settlement_phone_key,
    'name:' || lower(se.settlement_patient_name),
    'settlement:' || se.id::TEXT
  ),
  COALESCE(se.matched_patient_id, se.settlement_patient_id),
  COALESCE(
    NULLIF(btrim(se.matched_patient_name), ''),
    se.settlement_patient_name,
    se.parsed_template_patient_name,
    CASE WHEN se.settlement_phone_key IS NOT NULL THEN 'Tel. ' || se.settlement_phone_key END,
    'Paciente sin identificar'
  ),
  se.settlement_phone_key,
  CASE
    WHEN se.matched_patient_id IS NOT NULL THEN 'patients'
    WHEN se.settlement_patient_id IS NOT NULL THEN 'settlement_patient_id'
    WHEN se.settlement_phone_key IS NOT NULL THEN 'settlement_phone'
    WHEN se.settlement_patient_name IS NOT NULL THEN 'settlement_patient_name'
    ELSE 'unidentified_settlement'
  END;

COMMENT ON VIEW public.vw_financial_patient_production IS
  'Patient-level production rollup from financial_settlements. Uses patient_id, clinic-scoped 9-digit phone matching, settlement patient_name, parsed template name, and settlement id fallbacks so NULL patient_name rows remain auditable.';

GRANT SELECT ON public.vw_financial_patient_production TO authenticated;
GRANT SELECT ON public.vw_financial_patient_production TO service_role;

COMMIT;
