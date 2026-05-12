-- Fix PL/pgSQL static analysis error in run_doctoralia_name_match():
-- The DECLARE section had "l RECORD" and the inner FOR loop used "l" as a
-- table alias for public.leads, causing the plpgsql checker to report
-- "record l is not assigned yet" (sqlState 55000).
-- Fix: rename the inner table alias to "ld" throughout the FOR query.

CREATE OR REPLACE FUNCTION public.run_doctoralia_name_match()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  patient_row RECORD;
  lead_row    RECORD;
  sim         NUMERIC;
  ph_match    BOOLEAN;
  best_lid    UUID;
  best_score  NUMERIC := 0;
BEGIN
  FOR patient_row IN SELECT * FROM public.doctoralia_patients LOOP
    best_lid   := NULL;
    best_score := 0;
    FOR lead_row IN
      SELECT ld.id, ld.name, ld.phone
      FROM public.leads ld
      JOIN public.users u ON u.id = ld.user_id
      WHERE u.clinic_id = patient_row.clinic_id
    LOOP
      sim      := extensions.similarity(patient_row.name_norm, lower(extensions.unaccent(COALESCE(lead_row.name, ''))));
      ph_match := patient_row.phone_primary IS NOT NULL
                  AND lead_row.phone IS NOT NULL
                  AND patient_row.phone_primary = regexp_replace(lead_row.phone, '\D', '', 'g');
      IF sim > best_score OR (sim = best_score AND ph_match) THEN
        best_score := sim;
        best_lid   := lead_row.id;
      END IF;
    END LOOP;
    IF best_lid IS NOT NULL AND best_score >= 0.85 THEN
      UPDATE public.doctoralia_patients
        SET lead_id          = best_lid,
            match_confidence = best_score,
            match_class      = CASE
              WHEN best_score = 1.0 THEN 'exact_match'
              WHEN best_score >= 0.92 THEN 'high_confidence'
              ELSE 'possible_match'
            END
      WHERE doc_patient_id = patient_row.doc_patient_id AND clinic_id = patient_row.clinic_id;
    END IF;
  END LOOP;
END;
$$;
