-- Migration: Add patient_phone to financial_settlements, backfill, index, and repopulate
-- doctoralia_patients with phone-based matching (phone-only rows were skipped in migration
-- 20260506100000 because the ELSE branch ran when patient_phone did not yet exist).

-- Step 1: Add the column unconditionally (idempotent).
ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS patient_phone TEXT;

-- Step 2: Backfill patient_phone from patients.phone if that column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'patients'
      AND column_name  = 'phone'
  ) THEN
    UPDATE public.financial_settlements fs
    SET patient_phone = NULLIF(public.normalize_phone(p.phone), '')
    FROM public.patients p
    WHERE fs.patient_phone IS NULL
      AND fs.patient_id    = p.id
      AND p.phone IS NOT NULL
      AND NULLIF(public.normalize_phone(p.phone), '') IS NOT NULL;
  END IF;
END $$;

-- Step 3: Index for clinic + phone lookups (idempotent).
CREATE INDEX IF NOT EXISTS financial_settlements_patient_phone_idx
  ON public.financial_settlements (clinic_id, patient_phone)
  WHERE patient_phone IS NOT NULL;

-- Step 4: Re-populate doctoralia_patients when the required identity columns are present.
DO $$
DECLARE
  has_patient_dni BOOLEAN;
  has_patient_name BOOLEAN;
  doc_id_expr TEXT;
  identity_predicate TEXT;
  group_by_expr TEXT;
BEGIN
  IF to_regclass('public.doctoralia_patients') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia patient phone population: public.doctoralia_patients does not exist';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_settlements' AND column_name = 'patient_dni'
  ) INTO has_patient_dni;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'financial_settlements' AND column_name = 'patient_name'
  ) INTO has_patient_name;

  IF NOT has_patient_name THEN
    RAISE NOTICE 'Skipping Doctoralia patient phone population: public.financial_settlements.patient_name does not exist';
    RETURN;
  END IF;

  IF has_patient_dni THEN
    doc_id_expr := 'COALESCE(NULLIF(fs.patient_dni, ''''), ''ph:'' || public.normalize_phone(fs.patient_phone))';
    identity_predicate := 'COALESCE(NULLIF(fs.patient_dni, ''''), public.normalize_phone(fs.patient_phone)) IS NOT NULL';
    group_by_expr := 'fs.clinic_id, fs.patient_dni, fs.patient_phone, fs.patient_name';
  ELSE
    doc_id_expr := '''ph:'' || public.normalize_phone(fs.patient_phone)';
    identity_predicate := 'public.normalize_phone(fs.patient_phone) IS NOT NULL';
    group_by_expr := 'fs.clinic_id, fs.patient_phone, fs.patient_name';
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
      public.normalize_phone(fs.patient_phone) AS phone_primary,
      MIN(fs.settled_at) AS first_seen_at,
      NULL AS match_confidence,
      NULL AS match_class
    FROM public.financial_settlements fs
    WHERE fs.cancelled_at IS NULL
      AND fs.patient_name  IS NOT NULL
      AND fs.amount_net    > 0
      AND %s
    GROUP BY %s
    ON CONFLICT (doc_patient_id, clinic_id) DO UPDATE
    SET full_name     = EXCLUDED.full_name,
        name_norm     = EXCLUDED.name_norm,
        phone_primary = COALESCE(EXCLUDED.phone_primary, public.doctoralia_patients.phone_primary),
        first_seen_at = LEAST(public.doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at)
  $SQL$, doc_id_expr, identity_predicate, group_by_expr);

  IF has_patient_dni THEN
    EXECUTE $SQL$
      UPDATE public.doctoralia_patients dp
      SET phone_primary = sub.phone_norm
      FROM (
        SELECT
          NULLIF(fs.patient_dni, '') AS doc_patient_id,
          fs.clinic_id,
          MAX(public.normalize_phone(fs.patient_phone)) AS phone_norm
        FROM public.financial_settlements fs
        WHERE NULLIF(fs.patient_dni, '') IS NOT NULL
        GROUP BY fs.patient_dni, fs.clinic_id
      ) sub
      WHERE dp.phone_primary   IS NULL
        AND dp.doc_patient_id   = sub.doc_patient_id
        AND dp.clinic_id        = sub.clinic_id
        AND sub.phone_norm      IS NOT NULL
    $SQL$;
  END IF;
END $$;

SELECT public.run_doctoralia_name_match();

-- Step 5: Schedule daily Doctoralia name matching.
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
