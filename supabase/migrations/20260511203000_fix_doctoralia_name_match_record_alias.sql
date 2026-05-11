-- Finalize run_doctoralia_name_match() without ambiguous PL/pgSQL record aliases.
--
-- Supabase security lint/plpgsql_check can report "record \"l\" is not assigned yet"
-- when a loop record and SQL aliases share or resemble the same identifier across
-- replacements. This definition uses explicit, descriptive record names only.

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
