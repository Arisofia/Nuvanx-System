-- =============================================================================
-- Reconcile Doctoralia appointment subjects to CRM lead pipeline stages
--
-- Doctoralia exports place patient identity and the visit reason in template_name /
-- Asunto, for example:
--   "1. NAME [657174670 - 657174670] (Primera visita)"
--   "69. NAME [636575326] (VALORACIÓN GRATUITA)"
-- This migration parses bracketed phones and subject text to advance acquisition
-- leads from Meta into appointment/treatment stages by clinic-scoped phone match.
-- =============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS treatment_name VARCHAR(255);

ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS patient_phone TEXT,
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

-- Backfill Doctoralia phone fields from Asunto/template_name when the dedicated
-- patient_phone column is empty. Handles repeated phones: [657174670 - 657174670].
WITH extracted AS (
  SELECT DISTINCT ON (fs.id)
    fs.id,
    public.normalize_phone(token.phone_token) AS phone_normalized
  FROM public.financial_settlements fs
  CROSS JOIN LATERAL regexp_matches(COALESCE(fs.template_name, ''), '\[([^\]]+)\]', 'g') AS bracket(raw_value)
  CROSS JOIN LATERAL regexp_split_to_table(bracket.raw_value[1], '[^0-9+]+') AS token(phone_token)
  WHERE fs.source_system = 'doctoralia'
    AND public.normalize_phone(token.phone_token) IS NOT NULL
  ORDER BY fs.id, LENGTH(public.normalize_phone(token.phone_token)) DESC
)
UPDATE public.financial_settlements fs
SET patient_phone = COALESCE(fs.patient_phone, extracted.phone_normalized),
    phone_normalized = COALESCE(fs.phone_normalized, extracted.phone_normalized)
FROM extracted
WHERE fs.id = extracted.id
  AND (fs.patient_phone IS NULL OR fs.phone_normalized IS NULL);

CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_subjects_to_leads(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  WITH scoped_user AS (
    SELECT u.id AS user_id, u.clinic_id
    FROM public.users u
    WHERE u.id = p_user_id
  ),
  scoped_leads AS (
    SELECT l.id, l.clinic_id, l.user_id, l.phone_normalized
    FROM public.leads l
    JOIN scoped_user su
      ON (
        (su.clinic_id IS NOT NULL AND l.clinic_id = su.clinic_id)
        OR (su.clinic_id IS NULL AND l.user_id = su.user_id)
      )
    WHERE l.deleted_at IS NULL
      AND COALESCE(l.source, '') <> 'doctoralia'
      AND l.phone_normalized IS NOT NULL
      AND l.phone_normalized <> ''
  ),
  settlement_base AS (
    SELECT
      fs.id,
      fs.clinic_id,
      fs.patient_id,
      fs.template_name,
      fs.amount_net,
      COALESCE(fs.intake_at, fs.settled_at, fs.created_at) AS event_at,
      LOWER(TRANSLATE(COALESCE(fs.template_name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS subject_norm,
      NULLIF(public.normalize_phone(fs.patient_phone), '') AS patient_phone_norm,
      NULLIF(fs.phone_normalized, '') AS stored_phone_norm
    FROM public.financial_settlements fs
    WHERE fs.source_system = 'doctoralia'
      AND fs.cancelled_at IS NULL
      AND fs.template_name IS NOT NULL
  ),
  subject_phone_tokens AS (
    SELECT
      sb.*,
      NULLIF(public.normalize_phone(token.phone_token), '') AS subject_phone_norm
    FROM settlement_base sb
    CROSS JOIN LATERAL regexp_matches(sb.template_name, '\[([^\]]+)\]', 'g') AS bracket(raw_value)
    CROSS JOIN LATERAL regexp_split_to_table(bracket.raw_value[1], '[^0-9+]+') AS token(phone_token)
  ),
  settlement_phones AS (
    SELECT id, clinic_id, patient_id, template_name, amount_net, event_at, subject_norm, patient_phone_norm AS phone_norm
    FROM settlement_base
    WHERE patient_phone_norm IS NOT NULL
    UNION
    SELECT id, clinic_id, patient_id, template_name, amount_net, event_at, subject_norm, stored_phone_norm AS phone_norm
    FROM settlement_base
    WHERE stored_phone_norm IS NOT NULL
    UNION
    SELECT id, clinic_id, patient_id, template_name, amount_net, event_at, subject_norm, subject_phone_norm AS phone_norm
    FROM subject_phone_tokens
    WHERE subject_phone_norm IS NOT NULL
  ),
  matched_events AS (
    SELECT DISTINCT
      sl.id AS lead_id,
      sp.id AS settlement_id,
      sp.patient_id,
      sp.template_name,
      sp.amount_net,
      sp.event_at,
      (
        sp.subject_norm LIKE '%valoraci%'
        OR sp.subject_norm LIKE '%primera%'
      ) AS is_appointment
    FROM scoped_leads sl
    JOIN settlement_phones sp
      ON sp.clinic_id = sl.clinic_id
     AND (
       sp.phone_norm = sl.phone_normalized
       OR RIGHT(regexp_replace(sp.phone_norm, '[^0-9]', '', 'g'), 9)
        = RIGHT(regexp_replace(sl.phone_normalized, '[^0-9]', '', 'g'), 9)
     )
  ),
  first_appointment AS (
    SELECT lead_id, MIN(event_at) AS first_appointment_at
    FROM matched_events
    WHERE is_appointment
    GROUP BY lead_id
  ),
  first_treatment AS (
    SELECT DISTINCT ON (me.lead_id)
      me.lead_id,
      me.event_at AS first_treatment_at,
      me.template_name AS first_treatment_name
    FROM matched_events me
    JOIN first_appointment fa ON fa.lead_id = me.lead_id
    WHERE NOT me.is_appointment
      AND me.event_at >= fa.first_appointment_at
    ORDER BY me.lead_id, me.event_at ASC, me.template_name ASC
  ),
  revenue AS (
    SELECT lead_id, SUM(COALESCE(amount_net, 0)) AS verified_revenue
    FROM matched_events
    GROUP BY lead_id
  ),
  patient_match AS (
    SELECT DISTINCT ON (lead_id) lead_id, patient_id
    FROM matched_events
    WHERE patient_id IS NOT NULL
    ORDER BY lead_id, event_at ASC
  ),
  updated AS (
    UPDATE public.leads l
    SET
      stage = CASE
        WHEN l.stage = 'closed' THEN l.stage
        WHEN ft.first_treatment_at IS NOT NULL THEN 'treatment'
        WHEN fa.first_appointment_at IS NOT NULL AND l.stage IN ('lead', 'whatsapp') THEN 'appointment'
        ELSE l.stage
      END,
      appointment_date = COALESCE(l.appointment_date, fa.first_appointment_at),
      treatment_name = COALESCE(l.treatment_name, ft.first_treatment_name),
      converted_patient_id = COALESCE(l.converted_patient_id, pm.patient_id),
      verified_revenue = GREATEST(COALESCE(l.verified_revenue, 0), COALESCE(rev.verified_revenue, 0)),
      updated_at = NOW()
    FROM first_appointment fa
    LEFT JOIN first_treatment ft ON ft.lead_id = fa.lead_id
    LEFT JOIN revenue rev ON rev.lead_id = fa.lead_id
    LEFT JOIN patient_match pm ON pm.lead_id = fa.lead_id
    WHERE l.id = fa.lead_id
      AND l.stage IS DISTINCT FROM 'closed'
      AND (
        (ft.first_treatment_at IS NOT NULL AND l.stage IS DISTINCT FROM 'treatment')
        OR (ft.first_treatment_at IS NULL AND fa.first_appointment_at IS NOT NULL AND l.stage IN ('lead', 'whatsapp'))
        OR l.appointment_date IS NULL
        OR (ft.first_treatment_name IS NOT NULL AND l.treatment_name IS NULL)
        OR (pm.patient_id IS NOT NULL AND l.converted_patient_id IS NULL)
        OR COALESCE(l.verified_revenue, 0) < COALESCE(rev.verified_revenue, 0)
      )
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN COALESCE(updated_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_doctoralia_subjects_to_leads(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_doctoralia_subjects_to_leads(UUID) TO service_role;
