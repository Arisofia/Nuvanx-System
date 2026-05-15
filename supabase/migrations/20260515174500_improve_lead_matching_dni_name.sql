-- =============================================================================
-- Improve Lead Matching with DNI and Name logic
--
-- This migration enhances the reconciliation process to match acquisition leads
-- to Doctoralia patients using DNI/hash and normalized name if phone matching
-- fails. This ensures higher attribution accuracy for the ROI dashboard.
-- =============================================================================

BEGIN;

-- 1. Function to normalize names for fuzzy matching (removes accents, spaces, special chars)
CREATE OR REPLACE FUNCTION public.normalize_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN NULL;
  END IF;

  -- Remove accents and special characters, to lowercase, trim
  cleaned := lower(extensions.unaccent(btrim(p_name)));
  cleaned := regexp_replace(cleaned, '[^a-z0-9]', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

-- 2. Update reconcile_doctoralia_subjects_to_leads to include DNI and Name matching
CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_subjects_to_leads(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  WITH scoped_user AS (
    SELECT u.id AS user_id, u.clinic_id
    FROM public.users u
    WHERE u.id = p_user_id
  ),
  scoped_leads AS (
    SELECT l.id, l.clinic_id, l.user_id, l.phone_normalized, l.dni, l.name AS lead_name,
           public.normalize_name(l.name) AS lead_name_norm
    FROM public.leads l
    JOIN scoped_user su
      ON (
        (su.clinic_id IS NOT NULL AND l.clinic_id = su.clinic_id)
        OR (su.clinic_id IS NULL AND l.user_id = su.user_id)
      )
    WHERE l.deleted_at IS NULL
      AND COALESCE(l.source, '') <> 'doctoralia'
      AND l.converted_patient_id IS NULL
  ),
  settlement_base AS (
    SELECT
      fs.id,
      fs.clinic_id,
      fs.patient_id,
      fs.template_name,
      fs.amount_net,
      COALESCE(fs.intake_at, fs.settled_at, fs.created_at) AS event_at,
      LOWER(TRANSLATE(COALESCE(fs.template_name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS subject_norm,
      NULLIF(public.normalize_phone(fs.patient_phone), '') AS patient_phone_norm,
      NULLIF(fs.phone_normalized, '') AS stored_phone_norm
    FROM public.financial_settlements fs
    WHERE fs.source_system = 'doctoralia'
      AND fs.cancelled_at IS NULL
  ),
  patient_lookup AS (
    SELECT
      p.id AS patient_id,
      p.clinic_id,
      p.dni,
      p.phone_normalized,
      public.normalize_name(p.name) AS patient_name_norm
    FROM public.patients p
  ),
  matched_events AS (
    SELECT DISTINCT
      sl.id AS lead_id,
      sb.id AS settlement_id,
      sb.patient_id,
      sb.template_name,
      sb.amount_net,
      sb.event_at,
      (
        sb.subject_norm LIKE '%valoraci%'
        OR sb.subject_norm LIKE '%primera%'
      ) AS is_appointment
    FROM scoped_leads sl
    CROSS JOIN settlement_base sb
    LEFT JOIN patient_lookup pl ON pl.patient_id = sb.patient_id
    WHERE sb.clinic_id = sl.clinic_id
     AND (
       -- Match by Phone (Last 9 digits)
       RIGHT(regexp_replace(sb.patient_phone_norm, '[^0-9]', '', 'g'), 9) = RIGHT(regexp_replace(sl.phone_normalized, '[^0-9]', '', 'g'), 9)
       OR RIGHT(regexp_replace(sb.stored_phone_norm, '[^0-9]', '', 'g'), 9) = RIGHT(regexp_replace(sl.phone_normalized, '[^0-9]', '', 'g'), 9)
       -- Match by DNI
       OR (sl.dni IS NOT NULL AND pl.dni IS NOT NULL AND sl.dni = pl.dni)
       -- Match by Normalized Name (only if phone is missing or mismatching, as a fallback)
       OR (sl.lead_name_norm IS NOT NULL AND pl.patient_name_norm IS NOT NULL AND sl.lead_name_norm = pl.patient_name_norm)
     )
  ),
  first_appointment AS (
    SELECT lead_id, MIN(event_at) AS first_appointment_at
    FROM matched_events
    WHERE is_appointment
    GROUP BY lead_id
  ),
  first_treatment AS (
    SELECT DISTINCT ON (me.lead_id)
      me.lead_id,
      me.event_at AS first_treatment_at,
      me.template_name AS first_treatment_name
    FROM matched_events me
    JOIN first_appointment fa ON fa.lead_id = me.lead_id
    WHERE NOT me.is_appointment
      AND me.event_at >= fa.first_appointment_at
    ORDER BY me.lead_id, me.event_at ASC, me.template_name ASC
  ),
  revenue AS (
    SELECT lead_id, SUM(COALESCE(amount_net, 0)) AS verified_revenue
    FROM matched_events
    GROUP BY lead_id
  ),
  patient_match AS (
    SELECT DISTINCT ON (lead_id) lead_id, patient_id
    FROM matched_events
    WHERE patient_id IS NOT NULL
    ORDER BY lead_id, event_at ASC
  ),
  updated AS (
    UPDATE public.leads l
    SET
      stage = CASE
        WHEN l.stage = 'closed' THEN l.stage
        WHEN ft.first_treatment_at IS NOT NULL THEN 'treatment'
        WHEN fa.first_appointment_at IS NOT NULL AND l.stage IN ('lead', 'whatsapp') THEN 'appointment'
        ELSE l.stage
      END,
      appointment_date = COALESCE(l.appointment_date, fa.first_appointment_at),
      treatment_name = COALESCE(l.treatment_name, ft.first_treatment_name),
      converted_patient_id = COALESCE(l.converted_patient_id, pm.patient_id),
      verified_revenue = GREATEST(COALESCE(l.verified_revenue, 0), COALESCE(rev.verified_revenue, 0)),
      updated_at = NOW()
    FROM first_appointment fa
    LEFT JOIN first_treatment ft ON ft.lead_id = fa.lead_id
    LEFT JOIN revenue rev ON rev.lead_id = fa.lead_id
    LEFT JOIN patient_match pm ON pm.lead_id = fa.lead_id
    WHERE l.id = fa.lead_id
      AND l.stage IS DISTINCT FROM 'closed'
      AND (
        (ft.first_treatment_at IS NOT NULL AND l.stage IS DISTINCT FROM 'treatment')
        OR (ft.first_treatment_at IS NULL AND fa.first_appointment_at IS NOT NULL AND l.stage IN ('lead', 'whatsapp'))
        OR l.appointment_date IS NULL
        OR (ft.first_treatment_name IS NOT NULL AND l.treatment_name IS NULL)
        OR (pm.patient_id IS NOT NULL AND l.converted_patient_id IS NULL)
        OR COALESCE(l.verified_revenue, 0) < COALESCE(rev.verified_revenue, 0)
      )
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN COALESCE(updated_count, 0);
END;
$$;

-- 3. Dedicated DNI-based matching function for direct link (faster)
CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_dni(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER;
  v_clinic_id UUID;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  WITH updated_leads AS (
    UPDATE public.leads l
    SET converted_patient_id = p.id,
        updated_at = NOW()
    FROM public.patients p
    WHERE l.clinic_id = v_clinic_id
      AND l.dni IS NOT NULL
      AND l.converted_patient_id IS NULL
      AND p.dni IS NOT NULL
      AND l.dni = p.dni
      AND p.clinic_id = v_clinic_id
      AND (l.source IS NULL OR l.source != 'doctoralia')
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated_leads;

  RETURN COALESCE(updated_count, 0);
END;
$$;

-- 4. Update phone-based matching function to accept user_id and use clinic scoping
CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER;
  v_clinic_id UUID;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  WITH updated_leads AS (
    UPDATE public.leads l
    SET converted_patient_id = p.id,
        updated_at = NOW()
    FROM public.patients p
    WHERE l.clinic_id = v_clinic_id
      AND l.phone_normalized IS NOT NULL
      AND l.converted_patient_id IS NULL
      AND p.phone_normalized IS NOT NULL
      AND l.phone_normalized = p.phone_normalized
      AND p.clinic_id = v_clinic_id
      AND (l.source IS NULL OR l.source != 'doctoralia')
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated_leads;

  RETURN COALESCE(updated_count, 0);
END;
$$;

-- 5. Dedicated Name-based matching function (fuzzy/normalized fallback)
CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_name(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER;
  v_clinic_id UUID;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  WITH updated_leads AS (
    UPDATE public.leads l
    SET converted_patient_id = p.id,
        updated_at = NOW()
    FROM public.patients p
    WHERE l.clinic_id = v_clinic_id
      AND l.converted_patient_id IS NULL
      AND l.name IS NOT NULL
      AND p.name IS NOT NULL
      AND p.clinic_id = v_clinic_id
      AND public.normalize_name(l.name) = public.normalize_name(p.name)
      AND (l.source IS NULL OR l.source != 'doctoralia')
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated_leads;

  RETURN COALESCE(updated_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_leads_to_doctoralia_by_dni(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_leads_to_doctoralia_by_phone(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_leads_to_doctoralia_by_name(UUID) TO service_role;

COMMIT;
