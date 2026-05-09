-- Migration: Repopulate doctoralia_patients using patient_phone fallback and schedule matching
-- This migration extends the existing doctoralia patient population beyond DNI-only rows.

DO $$
DECLARE
  has_patient_dni BOOLEAN;
  has_patient_phone BOOLEAN;
  has_patient_name BOOLEAN;
  doc_id_expr TEXT;
  identity_predicate TEXT;
  group_by_expr TEXT;
BEGIN
  IF to_regclass('public.financial_settlements') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia patient population: public.financial_settlements does not exist';
    RETURN;
  END IF;

  IF to_regclass('public.doctoralia_patients') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia patient population: public.doctoralia_patients does not exist';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_settlements' AND column_name = 'patient_dni'
  ) INTO has_patient_dni;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_settlements' AND column_name = 'patient_phone'
  ) INTO has_patient_phone;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_settlements' AND column_name = 'patient_name'
  ) INTO has_patient_name;

  IF NOT has_patient_name THEN
    RAISE NOTICE 'Skipping Doctoralia patient population: public.financial_settlements.patient_name does not exist';
    RETURN;
  END IF;

  IF NOT has_patient_dni AND NOT has_patient_phone THEN
    RAISE NOTICE 'Skipping Doctoralia patient population: neither patient_dni nor patient_phone exists';
    RETURN;
  END IF;

  IF has_patient_dni AND has_patient_phone THEN
    doc_id_expr := 'COALESCE(NULLIF(fs.patient_dni, ''''), ''ph:'' || NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''''), ''\D'', '''', ''g''), ''''))';
    identity_predicate := 'COALESCE(NULLIF(fs.patient_dni, ''''), NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''''), ''\D'', '''', ''g''), '''')) IS NOT NULL';
    group_by_expr := 'fs.clinic_id, fs.patient_dni, fs.patient_phone, fs.patient_name';
  ELSIF has_patient_phone THEN
    doc_id_expr := '''ph:'' || NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''''), ''\D'', '''', ''g''), '''')';
    identity_predicate := 'NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''''), ''\D'', '''', ''g''), '''') IS NOT NULL';
    group_by_expr := 'fs.clinic_id, fs.patient_phone, fs.patient_name';
  ELSE
    doc_id_expr := 'NULLIF(fs.patient_dni, '''')';
    identity_predicate := 'NULLIF(fs.patient_dni, '''') IS NOT NULL';
    group_by_expr := 'fs.clinic_id, fs.patient_dni, fs.patient_name';
  END IF;

  EXECUTE format($SQL$
    INSERT INTO public.doctoralia_patients (
      doc_patient_id, clinic_id, full_name, name_norm, phone_primary, first_seen_at,
      match_confidence, match_class
    )
    SELECT
      %s AS doc_patient_id,
      fs.clinic_id,
      UPPER(TRIM(fs.patient_name)) AS full_name,
      LOWER(REGEXP_REPLACE(extensions.unaccent(TRIM(fs.patient_name)), '\s+', ' ', 'g')) AS name_norm,
      %s AS phone_primary,
      MIN(fs.settled_at) AS first_seen_at,
      NULL AS match_confidence,
      NULL AS match_class
    FROM public.financial_settlements fs
    WHERE fs.cancelled_at IS NULL
      AND fs.patient_name IS NOT NULL
      AND fs.amount_net > 0
      AND %s
    GROUP BY %s
    ON CONFLICT (doc_patient_id, clinic_id) DO UPDATE
    SET full_name     = EXCLUDED.full_name,
        name_norm     = EXCLUDED.name_norm,
        phone_primary = COALESCE(EXCLUDED.phone_primary, public.doctoralia_patients.phone_primary),
        first_seen_at = LEAST(public.doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at)
  $SQL$,
    doc_id_expr,
    CASE WHEN has_patient_phone
      THEN 'NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''''), ''\D'', '''', ''g''), '''')'
      ELSE 'NULL'
    END,
    identity_predicate,
    group_by_expr
  );

  IF has_patient_dni AND has_patient_phone THEN
    EXECUTE $SQL$
      UPDATE public.doctoralia_patients dp
      SET phone_primary = sub.phone_norm
      FROM (
        SELECT fs.patient_dni AS doc_patient_id, fs.clinic_id,
              MAX(NULLIF(regexp_replace(COALESCE(fs.patient_phone,''), '\D', '', 'g'), '')) AS phone_norm
        FROM public.financial_settlements fs
        WHERE fs.patient_dni IS NOT NULL
        GROUP BY fs.patient_dni, fs.clinic_id
      ) sub
      WHERE dp.phone_primary IS NULL
        AND dp.doc_patient_id = sub.doc_patient_id
        AND dp.clinic_id      = sub.clinic_id
        AND sub.phone_norm    IS NOT NULL
    $SQL$;
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
