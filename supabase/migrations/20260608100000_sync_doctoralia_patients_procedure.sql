-- =============================================================================
-- Migration: Sync Doctoralia Patients Procedure
-- Purpose: Ensures doctoralia_patients is kept in sync with financial_settlements.
-- =============================================================================

BEGIN;

-- 1. Create a function to sync doctoralia_patients from financial_settlements
CREATE OR REPLACE FUNCTION public.sync_doctoralia_patients()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog', 'extensions'
AS $$
DECLARE
  v_inserted_count INTEGER := 0;
BEGIN
  -- Insert or update patients based on DNI/Phone from financial_settlements
  -- We prefer patient_dni if available, otherwise phone-based ID
  INSERT INTO public.doctoralia_patients (
    doc_patient_id,
    clinic_id,
    full_name,
    name_norm,
    phone_primary,
    phone_normalized,
    first_seen_at,
    match_confidence,
    match_class
  )
  SELECT
    COALESCE(NULLIF(fs.patient_dni, ''), 'ph:' || fs.phone_normalized) AS doc_patient_id,
    fs.clinic_id,
    MAX(UPPER(TRIM(fs.patient_name))) AS full_name,
    MAX(LOWER(REGEXP_REPLACE(extensions.unaccent(TRIM(fs.patient_name)), '\s+', ' ', 'g'))) AS name_norm,
    MAX(fs.patient_phone) AS phone_primary,
    MAX(fs.phone_normalized) AS phone_normalized,
    MIN(fs.settled_at) AS first_seen_at,
    1.0 AS match_confidence,
    CASE WHEN fs.patient_dni IS NOT NULL THEN 'dni_match' ELSE 'phone_match' END AS match_class
  FROM public.financial_settlements fs
  WHERE fs.cancelled_at IS NULL
    AND fs.patient_name IS NOT NULL
    AND (fs.patient_dni IS NOT NULL OR fs.phone_normalized IS NOT NULL)
    AND fs.amount_net > 0
    AND fs.source_system = 'doctoralia'
  GROUP BY fs.clinic_id, doc_patient_id, (fs.patient_dni IS NOT NULL)
  ON CONFLICT (doc_patient_id, clinic_id) DO UPDATE
  SET
    full_name        = EXCLUDED.full_name,
    name_norm        = EXCLUDED.name_norm,
    phone_primary    = COALESCE(EXCLUDED.phone_primary, doctoralia_patients.phone_primary),
    phone_normalized = COALESCE(EXCLUDED.phone_normalized, doctoralia_patients.phone_normalized),
    first_seen_at    = LEAST(doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at)
  ;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count;
END;
$$;

-- 2. Initial sync
SELECT public.sync_doctoralia_patients();

-- 3. Grant permissions
REVOKE ALL ON FUNCTION public.sync_doctoralia_patients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_doctoralia_patients() TO service_role;

COMMIT;
