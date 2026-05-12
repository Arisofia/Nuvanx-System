-- Fix doctoralia name matching to normalize lead names and phone numbers.
-- This improves matching between doctoralia_patients and Meta leadgen leads.

CREATE OR REPLACE FUNCTION public.run_doctoralia_name_match() RETURNS void
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
      SELECT ld.id,
             lower(extensions.unaccent(regexp_replace(COALESCE(ld.name, ''), '\s+', ' ', 'g'))) AS normalized_name,
             regexp_replace(COALESCE(ld.phone, ''), '\D', '', 'g') AS normalized_phone
      FROM public.leads ld
      JOIN public.users u ON u.id = ld.user_id
      WHERE u.clinic_id = patient_row.clinic_id
    LOOP
      sim := extensions.similarity(patient_row.name_norm, lead_row.normalized_name);
      ph_match := patient_row.phone_primary IS NOT NULL
                  AND lead_row.normalized_phone IS NOT NULL
                  AND right(lead_row.normalized_phone, 9) = patient_row.phone_primary;

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
