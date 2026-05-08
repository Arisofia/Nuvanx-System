-- Migration: Populate doctoralia_patients from identified financial_settlements
-- Only rows with patient_dni (and patient_name) are used.
-- doc_patient_id = patient_dni (9 chars, fits varchar(16)).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'financial_settlements'
      AND column_name = 'patient_dni'
  ) THEN
    INSERT INTO public.doctoralia_patients (
      doc_patient_id,
      clinic_id,
      full_name,
      name_norm,
      first_seen_at,
      match_confidence,
      match_class
    )
    SELECT
      fs.patient_dni                                     AS doc_patient_id,
      fs.clinic_id,
      UPPER(TRIM(fs.patient_name))                       AS full_name,
      LOWER(REGEXP_REPLACE(TRIM(fs.patient_name), '\s+', ' ', 'g')) AS name_norm,
      MIN(fs.settled_at)                                 AS first_seen_at,
      1.0                                                AS match_confidence,
      'dni_match'                                        AS match_class
    FROM public.financial_settlements fs
    WHERE fs.cancelled_at IS NULL
      AND fs.patient_dni  IS NOT NULL
      AND fs.patient_name IS NOT NULL
      AND fs.amount_net > 0
    GROUP BY fs.clinic_id, fs.patient_dni, fs.patient_name
    ON CONFLICT (doc_patient_id, clinic_id)
    DO UPDATE SET
      full_name        = EXCLUDED.full_name,
      name_norm        = EXCLUDED.name_norm,
      first_seen_at    = LEAST(doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at),
      match_confidence = EXCLUDED.match_confidence,
      match_class      = EXCLUDED.match_class;
  ELSE
    RAISE NOTICE 'Skipping doctoralia_patients population: column public.financial_settlements.patient_dni does not exist';
  END IF;
END;
$$;
