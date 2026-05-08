-- =============================================================================
-- Harden Doctoralia patient backfill from financial_settlements
--
-- This is a guarded repair migration for environments where the original
-- backfill may have skipped or failed because some financial_settlements
-- identity columns were missing. It does not modify historical migrations.
-- =============================================================================

DO $$
DECLARE
  missing_columns TEXT[];
  missing_target_columns TEXT[];
  name_norm_expr TEXT;
BEGIN
  IF to_regclass('public.financial_settlements') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia backfill hardening: public.financial_settlements does not exist';
    RETURN;
  END IF;

  IF to_regclass('public.doctoralia_patients') IS NULL THEN
    RAISE NOTICE 'Skipping Doctoralia backfill hardening: public.doctoralia_patients does not exist';
    RETURN;
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_columns
  FROM (
    VALUES
      ('clinic_id'),
      ('patient_dni'),
      ('patient_name'),
      ('settled_at'),
      ('cancelled_at'),
      ('amount_net')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'financial_settlements'
      AND c.column_name = required.column_name
  );

  IF COALESCE(array_length(missing_columns, 1), 0) > 0 THEN
    RAISE NOTICE 'Skipping Doctoralia backfill hardening: missing financial_settlements columns: %', missing_columns;
    RETURN;
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO missing_target_columns
  FROM (
    VALUES
      ('doc_patient_id'),
      ('clinic_id'),
      ('full_name'),
      ('name_norm'),
      ('first_seen_at'),
      ('match_confidence'),
      ('match_class')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'doctoralia_patients'
      AND c.column_name = required.column_name
  );

  IF COALESCE(array_length(missing_target_columns, 1), 0) > 0 THEN
    RAISE NOTICE 'Skipping Doctoralia backfill hardening: missing doctoralia_patients columns: %', missing_target_columns;
    RETURN;
  END IF;

  EXECUTE '
    CREATE INDEX IF NOT EXISTS financial_settlements_doctoralia_dni_backfill_idx
      ON public.financial_settlements (clinic_id, patient_dni, settled_at)
      WHERE patient_dni IS NOT NULL
        AND patient_name IS NOT NULL
        AND cancelled_at IS NULL
        AND amount_net > 0
  ';

  name_norm_expr := CASE
    WHEN to_regprocedure('extensions.unaccent(text)') IS NOT NULL THEN
      'LOWER(REGEXP_REPLACE(extensions.unaccent(TRIM(fs.patient_name)), ''\s+'', '' '', ''g''))'
    WHEN to_regprocedure('public.unaccent(text)') IS NOT NULL THEN
      'LOWER(REGEXP_REPLACE(public.unaccent(TRIM(fs.patient_name)), ''\s+'', '' '', ''g''))'
    ELSE
      'LOWER(REGEXP_REPLACE(TRIM(fs.patient_name), ''\s+'', '' '', ''g''))'
  END;

  EXECUTE format($sql$
    WITH normalized_settlements AS (
      SELECT
        UPPER(REGEXP_REPLACE(TRIM(fs.patient_dni), '[^0-9A-Za-z]', '', 'g')) AS clean_dni,
        fs.clinic_id,
        UPPER(TRIM(fs.patient_name)) AS full_name,
        %s AS name_norm,
        fs.settled_at
      FROM public.financial_settlements fs
      WHERE fs.cancelled_at IS NULL
        AND fs.patient_dni IS NOT NULL
        AND fs.patient_name IS NOT NULL
        AND fs.amount_net > 0
    )
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
      clean_dni AS doc_patient_id,
      clinic_id,
      MAX(full_name) AS full_name,
      MAX(name_norm) AS name_norm,
      MIN(settled_at) AS first_seen_at,
      1.0 AS match_confidence,
      'dni_match_guarded' AS match_class
    FROM normalized_settlements
    WHERE clean_dni ~ '^[0-9XYZ][0-9]{7}[A-Z]$'
      AND length(clean_dni) <= 16
    GROUP BY clinic_id, clean_dni
    ON CONFLICT (doc_patient_id, clinic_id)
    DO UPDATE SET
      full_name = EXCLUDED.full_name,
      name_norm = EXCLUDED.name_norm,
      first_seen_at = LEAST(
        COALESCE(public.doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at),
        EXCLUDED.first_seen_at
      ),
      match_confidence = GREATEST(
        COALESCE(public.doctoralia_patients.match_confidence, 0),
        EXCLUDED.match_confidence
      ),
      match_class = EXCLUDED.match_class
  $sql$, name_norm_expr);

  ANALYZE public.doctoralia_patients;
END $$;
