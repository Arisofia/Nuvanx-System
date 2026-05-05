-- Migration: Repopulate doctoralia_patients using patient_phone fallback and schedule matching
-- This migration extends the existing doctoralia patient population beyond DNI-only rows.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'financial_settlements'
      AND column_name  = 'patient_phone'
  ) THEN
    -- Full logic when patient_phone exists
    EXECUTE $SQL$
      INSERT INTO public.doctoralia_patients (
        doc_patient_id, clinic_id, full_name, name_norm, phone_primary, first_seen_at,
        match_confidence, match_class
      )
      SELECT
        COALESCE(NULLIF(fs.patient_dni, ''), 'ph:' || regexp_replace(COALESCE(fs.patient_phone, ''), '\\D', '', 'g')) AS doc_patient_id,
        fs.clinic_id,
        UPPER(TRIM(fs.patient_name)) AS full_name,
        LOWER(REGEXP_REPLACE(extensions.unaccent(TRIM(fs.patient_name)), '\\s+', ' ', 'g')) AS name_norm,
        NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\\D', '', 'g'), '') AS phone_primary,
        MIN(fs.settled_at) AS first_seen_at,
        NULL AS match_confidence,
        NULL AS match_class
      FROM public.financial_settlements fs
      WHERE fs.cancelled_at IS NULL
        AND fs.patient_name IS NOT NULL
        AND fs.amount_net > 0
        AND COALESCE(fs.patient_dni, fs.patient_phone) IS NOT NULL
      GROUP BY fs.clinic_id, fs.patient_dni, fs.patient_phone, fs.patient_name
      ON CONFLICT (doc_patient_id, clinic_id) DO UPDATE
      SET full_name     = EXCLUDED.full_name,
          name_norm     = EXCLUDED.name_norm,
          phone_primary = COALESCE(EXCLUDED.phone_primary, public.doctoralia_patients.phone_primary),
          first_seen_at = LEAST(public.doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at);
    $SQL$;

    EXECUTE $SQL$
      UPDATE public.doctoralia_patients dp
      SET phone_primary = sub.phone_norm
      FROM (
        SELECT fs.patient_dni AS doc_patient_id, fs.clinic_id,
              MAX(NULLIF(regexp_replace(COALESCE(fs.patient_phone,''), '\\D', '', 'g'), '')) AS phone_norm
        FROM public.financial_settlements fs
        WHERE fs.patient_dni IS NOT NULL
        GROUP BY fs.patient_dni, fs.clinic_id
      ) sub
      WHERE dp.phone_primary IS NULL
        AND dp.doc_patient_id = sub.doc_patient_id
        AND dp.clinic_id      = sub.clinic_id
        AND sub.phone_norm    IS NOT NULL;
    $SQL$;

  ELSE
    -- Backward-compatible fallback if patient_phone doesn't exist yet: DNI-only population.
    INSERT INTO public.doctoralia_patients (
      doc_patient_id, clinic_id, full_name, name_norm, phone_primary, first_seen_at,
      match_confidence, match_class
    )
    SELECT
      NULLIF(fs.patient_dni, '') AS doc_patient_id,
      fs.clinic_id,
      UPPER(TRIM(fs.patient_name)) AS full_name,
      LOWER(REGEXP_REPLACE(extensions.unaccent(TRIM(fs.patient_name)), '\\s+', ' ', 'g')) AS name_norm,
      NULL AS phone_primary,
      MIN(fs.settled_at) AS first_seen_at,
      NULL AS match_confidence,
      NULL AS match_class
    FROM public.financial_settlements fs
    WHERE fs.cancelled_at IS NULL
      AND fs.patient_name IS NOT NULL
      AND fs.amount_net > 0
      AND fs.patient_dni IS NOT NULL
    GROUP BY fs.clinic_id, fs.patient_dni, fs.patient_name
    ON CONFLICT (doc_patient_id, clinic_id) DO UPDATE
    SET full_name     = EXCLUDED.full_name,
        name_norm     = EXCLUDED.name_norm,
        first_seen_at = LEAST(public.doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at);
  END IF;
END $$;

SELECT public.run_doctoralia_name_match();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('doctoralia-name-match-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'doctoralia-name-match-daily');
    PERFORM cron.schedule(
      'doctoralia-name-match-daily',
      '15 3 * * *',
      $cmd$SELECT public.run_doctoralia_name_match();$cmd$
    );
  END IF;
END $$;
