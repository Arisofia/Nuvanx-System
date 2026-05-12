-- Migration: Repopulate doctoralia_patients using patient_phone fallback and schedule matching
-- This migration extends the existing doctoralia patient population beyond DNI-only rows.

-- Fix run_doctoralia_name_match() shadowing bug before calling it
CREATE OR REPLACE FUNCTION public.run_doctoralia_name_match() RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  patient_row           RECORD;
  lead_candidate        RECORD;
  sim                   NUMERIC;
  phone_match           BOOLEAN;
  best_lead_id          UUID;
  best_score            NUMERIC := 0;
  best_confidence       NUMERIC := 0;
  best_last_token_match BOOLEAN := FALSE;
  best_lead_token_count INT := 0;
  candidate_tokens      TEXT[];
  candidate_token_count INT := 0;
  first_token_match     BOOLEAN;
  last_token_match      BOOLEAN;
  rank_score            NUMERIC;
BEGIN
  FOR patient_row IN
    SELECT *, regexp_split_to_array(name_norm, ' ') AS name_tokens
    FROM public.doctoralia_patients
  LOOP
    best_lead_id          := NULL;
    best_score            := 0;
    best_confidence       := 0;
    best_last_token_match := FALSE;
    best_lead_token_count := 0;

    FOR lead_candidate IN
      SELECT lead_row.id,
             lower(extensions.unaccent(regexp_replace(COALESCE(lead_row.name, ''), '\s+', ' ', 'g'))) AS normalized_name,
             regexp_replace(COALESCE(lead_row.phone, ''), '\D', '', 'g') AS normalized_phone,
             regexp_split_to_array(lower(extensions.unaccent(regexp_replace(COALESCE(lead_row.name, ''), '\s+', ' ', 'g'))), ' ') AS lead_tokens
      FROM public.leads lead_row
      JOIN public.users app_user ON app_user.id = lead_row.user_id
      WHERE app_user.clinic_id = patient_row.clinic_id
    LOOP
      candidate_tokens := lead_candidate.lead_tokens;
      candidate_token_count := COALESCE(array_length(candidate_tokens, 1), 0);
      sim := extensions.similarity(patient_row.name_norm, lead_candidate.normalized_name);
      phone_match := patient_row.phone_primary IS NOT NULL
                     AND lead_candidate.normalized_phone IS NOT NULL
                     AND right(lead_candidate.normalized_phone, 9) = patient_row.phone_primary;
      first_token_match := candidate_token_count >= 1 AND candidate_tokens[1] = ANY (patient_row.name_tokens);
      last_token_match := candidate_token_count >= 1 AND candidate_tokens[candidate_token_count] = ANY (patient_row.name_tokens);

      rank_score := sim
                    + CASE WHEN last_token_match THEN 0.18 ELSE 0 END
                    + CASE WHEN first_token_match THEN 0.05 ELSE 0 END
                    + CASE WHEN candidate_token_count >= 2 THEN 0.03 ELSE 0 END
                    + CASE WHEN phone_match THEN 0.10 ELSE 0 END;

      IF best_lead_id IS NULL OR rank_score > best_score OR (rank_score = best_score AND phone_match) THEN
        best_score := rank_score;
        best_confidence := sim;
        best_lead_id := lead_candidate.id;
        best_last_token_match := last_token_match;
        best_lead_token_count := candidate_token_count;
      END IF;
    END LOOP;

    IF best_lead_id IS NOT NULL AND (
         best_confidence >= 0.85
         OR (best_score >= 0.45 AND best_last_token_match AND best_lead_token_count >= 2)
         OR (best_score >= 0.70 AND best_confidence >= 0.40)
       ) THEN
      UPDATE public.doctoralia_patients
        SET lead_id          = best_lead_id,
            match_confidence = best_confidence,
            match_class      = CASE
              WHEN best_confidence = 1.0 THEN 'exact_match'
              WHEN best_confidence >= 0.92 THEN 'high_confidence'
              ELSE 'possible_match'
            END
      WHERE doc_patient_id = patient_row.doc_patient_id AND clinic_id = patient_row.clinic_id;
    END IF;
  END LOOP;
END;
$$;

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
