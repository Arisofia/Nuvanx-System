-- Fix doctoralia name matching to normalize lead names and phone numbers.
-- This improves matching between doctoralia_patients and Meta leadgen leads.

CREATE OR REPLACE FUNCTION public.run_doctoralia_name_match() RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  r           RECORD;
  l           RECORD;
  sim         NUMERIC;
  ph_match    BOOLEAN;
  best_lid    UUID;
  best_score  NUMERIC := 0;
BEGIN
  FOR r IN SELECT * FROM public.doctoralia_patients LOOP
    best_lid   := NULL;
    best_score := 0;
    FOR l IN
      SELECT l.id,
             lower(extensions.unaccent(regexp_replace(COALESCE(l.name, ''), '\s+', ' ', 'g'))) AS normalized_name,
             regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g') AS normalized_phone
      FROM public.leads l
      JOIN public.users u ON u.id = l.user_id
      WHERE u.clinic_id = r.clinic_id
    LOOP
      sim := extensions.similarity(r.name_norm, l.normalized_name);
      ph_match := r.phone_primary IS NOT NULL
                  AND l.normalized_phone IS NOT NULL
                  AND right(l.normalized_phone, 9) = r.phone_primary;

      IF sim > best_score OR (sim = best_score AND ph_match) THEN
        best_score := sim;
        best_lid   := l.id;
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
      WHERE doc_patient_id = r.doc_patient_id AND clinic_id = r.clinic_id;
    END IF;
  END LOOP;
END;
$$;
