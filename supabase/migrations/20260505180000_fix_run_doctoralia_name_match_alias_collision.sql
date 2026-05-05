-- Fix PL/pgSQL static analysis error: "record `l` is not assigned yet".
--
-- The previous version of run_doctoralia_name_match() declared a loop record
-- named `l` AND used `l` as a table alias for public.leads inside the inner
-- SELECT. plpgsql_check (run by `supabase db lint`) cannot resolve the
-- shadowing and treats `l.id` in the SELECT as a reference to the not-yet-
-- assigned outer record variable, breaking CI.
--
-- Fix: rename the inner table alias to `ld` (and the JOIN column references
-- accordingly). The loop record stays `l` so the loop body that references
-- l.id / l.normalized_name / l.normalized_phone is unchanged in behavior.

CREATE OR REPLACE FUNCTION public.run_doctoralia_name_match() RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  r                    RECORD;
  l                    RECORD;
  sim                  NUMERIC;
  ph_match             BOOLEAN;
  best_lid             UUID;
  best_score           NUMERIC := 0;
  best_confidence      NUMERIC := 0;
  best_last_token_match BOOLEAN := FALSE;
  best_lead_token_count INT := 0;
  lead_tokens          TEXT[];
  lead_token_count     INT := 0;
  first_token_match    BOOLEAN;
  last_token_match     BOOLEAN;
  rank_score           NUMERIC;
BEGIN
  FOR r IN
    SELECT *, regexp_split_to_array(name_norm, ' ') AS name_tokens
    FROM public.doctoralia_patients
  LOOP
    best_lid             := NULL;
    best_score           := 0;
    best_confidence      := 0;
    best_last_token_match := FALSE;
    best_lead_token_count := 0;

    FOR l IN
      SELECT ld.id,
             lower(extensions.unaccent(regexp_replace(COALESCE(ld.name, ''), '\s+', ' ', 'g'))) AS normalized_name,
             regexp_replace(COALESCE(ld.phone, ''), '\D', '', 'g') AS normalized_phone,
             regexp_split_to_array(lower(extensions.unaccent(regexp_replace(COALESCE(ld.name, ''), '\s+', ' ', 'g'))), ' ') AS lead_tokens
      FROM public.leads ld
      JOIN public.users u ON u.id = ld.user_id
      WHERE u.clinic_id = r.clinic_id
    LOOP
      lead_tokens := l.lead_tokens;
      lead_token_count := COALESCE(array_length(lead_tokens, 1), 0);
      sim := extensions.similarity(r.name_norm, l.normalized_name);
      ph_match := r.phone_primary IS NOT NULL
                  AND l.normalized_phone IS NOT NULL
                  AND right(l.normalized_phone, 9) = r.phone_primary;
      first_token_match := lead_token_count >= 1 AND lead_tokens[1] = ANY (r.name_tokens);
      last_token_match := lead_token_count >= 1 AND lead_tokens[lead_token_count] = ANY (r.name_tokens);

      rank_score := sim
                    + CASE WHEN last_token_match THEN 0.18 ELSE 0 END
                    + CASE WHEN first_token_match THEN 0.05 ELSE 0 END
                    + CASE WHEN lead_token_count >= 2 THEN 0.03 ELSE 0 END
                    + CASE WHEN ph_match THEN 0.10 ELSE 0 END;

      IF best_lid IS NULL OR rank_score > best_score OR (rank_score = best_score AND ph_match) THEN
        best_score := rank_score;
        best_confidence := sim;
        best_lid := l.id;
        best_last_token_match := last_token_match;
        best_lead_token_count := lead_token_count;
      END IF;
    END LOOP;

    IF best_lid IS NOT NULL AND (
         best_confidence >= 0.85
         OR (best_score >= 0.45 AND best_last_token_match AND best_lead_token_count >= 2)
         OR (best_score >= 0.70 AND best_confidence >= 0.40)
       ) THEN
      UPDATE public.doctoralia_patients
        SET lead_id          = best_lid,
            match_confidence = best_confidence,
            match_class      = CASE
              WHEN best_confidence = 1.0 THEN 'exact_match'
              WHEN best_confidence >= 0.92 THEN 'high_confidence'
              ELSE 'possible_match'
            END
      WHERE doc_patient_id = r.doc_patient_id AND clinic_id = r.clinic_id;
    END IF;
  END LOOP;
END;
$$;
