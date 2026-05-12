-- 20260430152000_fix_doctoralia_match_functions.sql
-- Re-create Doctoralia matching functions with fully qualified references
-- and correct clinic filtering logic to satisfy Supabase schema lint.

CREATE OR REPLACE FUNCTION public.reconcile_lead_to_patient(p_lead_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_lead       public.leads%ROWTYPE;
  v_patient_id UUID;
  v_clinic_id  UUID;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_lead.converted_patient_id IS NOT NULL THEN
    RETURN v_lead.converted_patient_id;
  END IF;

  SELECT u.clinic_id INTO v_clinic_id
  FROM public.users u
  WHERE u.id = v_lead.user_id
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_lead.dni_hash IS NOT NULL AND v_lead.name_normalized IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.dni_hash = v_lead.dni_hash
      AND p.name_normalized = v_lead.name_normalized
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  IF v_lead.dni_hash IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.dni_hash = v_lead.dni_hash
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  IF v_lead.phone_normalized IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.phone_normalized = v_lead.phone_normalized
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  IF v_lead.email_normalized IS NOT NULL THEN
    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.clinic_id = v_clinic_id
      AND p.email_normalized = v_lead.email_normalized
    LIMIT 1;

    IF v_patient_id IS NOT NULL THEN
      UPDATE public.leads
      SET converted_patient_id = v_patient_id,
          updated_at = NOW()
      WHERE id = p_lead_id;
      RETURN v_patient_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

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
