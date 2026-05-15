-- =============================================================================
-- Robust Phone-Only Matching (9-Digit Suffix)
--
-- This migration prioritizes phone matching as the primary (and most reliable)
-- bridge between Meta Leads and Doctoralia data. It uses the last 9 digits 
-- of the normalized phone to ensure matches even with different country 
-- code formats (+34, 0034, etc).
-- =============================================================================

BEGIN;

-- 1. Ensure phone_normalized is populated everywhere using the best possible logic
CREATE OR REPLACE FUNCTION public.normalize_phone_robust(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone) = '' THEN
    RETURN NULL;
  END IF;

  -- Remove everything except digits
  cleaned := regexp_replace(p_phone, '[^0-9]', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- If it has more than 9 digits and starts with 34 (Spain), strip it
  IF length(cleaned) > 9 AND cleaned LIKE '34%' THEN
    cleaned := substring(cleaned FROM 3);
  ELSIF length(cleaned) > 11 AND cleaned LIKE '0034%' THEN
    cleaned := substring(cleaned FROM 5);
  END IF;

  -- Return the last 9 digits as the "canonical" local format for Spain
  IF length(cleaned) >= 9 THEN
    RETURN RIGHT(cleaned, 9);
  END IF;

  RETURN cleaned;
END;
$$;

-- 2. Backfill all tables with robust normalization
UPDATE public.leads 
SET phone_normalized = public.normalize_phone_robust(phone)
WHERE phone IS NOT NULL;

UPDATE public.patients
SET phone_normalized = public.normalize_phone_robust(COALESCE(phone_normalized, dni)) -- sometimes phone is in DNI field by mistake
WHERE (phone_normalized IS NOT NULL OR dni IS NOT NULL);

UPDATE public.financial_settlements
SET phone_normalized = public.normalize_phone_robust(patient_phone)
WHERE patient_phone IS NOT NULL;

-- 3. Redefine matching function to use the ROBUST 9-digit suffix match
CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
  v_clinic_id UUID;
BEGIN
  -- Get clinic_id for scoping
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  -- Step 1: Link leads to patients by robust phone match
  WITH updated_leads AS (
    UPDATE public.leads l
    SET converted_patient_id = p.id,
        updated_at = NOW()
    FROM public.patients p
    WHERE l.clinic_id = v_clinic_id
      AND p.clinic_id = v_clinic_id
      AND l.converted_patient_id IS NULL
      AND l.phone IS NOT NULL
      AND (p.phone_normalized IS NOT NULL OR p.dni IS NOT NULL) -- DNI field sometimes contains phone
      AND (
        -- Match last 9 digits of lead phone with last 9 digits of patient phone/dni
        public.normalize_phone_robust(l.phone) = public.normalize_phone_robust(p.phone_normalized)
        OR public.normalize_phone_robust(l.phone) = public.normalize_phone_robust(p.dni)
      )
      AND (l.source IS NULL OR l.source != 'doctoralia')
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated_leads;

  -- Step 2: Directly link leads to revenue if they match financial_settlements by phone
  -- This handles cases where the patient record might be missing or disconnected
  WITH revenue_match AS (
    SELECT 
      l.id AS lead_id,
      SUM(COALESCE(fs.amount_net, 0)) AS verified_rev,
      MIN(COALESCE(fs.intake_at, fs.settled_at)) AS first_event
    FROM public.leads l
    JOIN public.financial_settlements fs ON fs.clinic_id = l.clinic_id
    WHERE l.clinic_id = v_clinic_id
      AND l.phone IS NOT NULL
      AND fs.patient_phone IS NOT NULL
      AND public.normalize_phone_robust(l.phone) = public.normalize_phone_robust(fs.patient_phone)
      AND (l.source IS NULL OR l.source != 'doctoralia')
    GROUP BY l.id
  )
  UPDATE public.leads l
  SET 
    verified_revenue = GREATEST(COALESCE(l.verified_revenue, 0), rm.verified_rev),
    appointment_date = COALESCE(l.appointment_date, rm.first_event),
    stage = CASE 
      WHEN l.stage IN ('lead', 'whatsapp') AND rm.first_event IS NOT NULL THEN 'appointment'
      ELSE l.stage
    END,
    updated_at = NOW()
  FROM revenue_match rm
  WHERE l.id = rm.lead_id
    AND (COALESCE(l.verified_revenue, 0) < rm.verified_rev OR l.appointment_date IS NULL);

  RETURN COALESCE(updated_count, 0);
END;
$$;

-- 4. Update the combined reconciliation function to prioritize Phone and 9-digit suffix
CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_subjects_to_leads(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
  v_clinic_id UUID;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  WITH scoped_leads AS (
    SELECT l.id, l.clinic_id, l.phone, l.phone_normalized
    FROM public.leads l
    WHERE l.clinic_id = v_clinic_id
      AND l.deleted_at IS NULL
      AND COALESCE(l.source, '') <> 'doctoralia'
  ),
  settlement_base AS (
    SELECT
      fs.id,
      fs.clinic_id,
      fs.patient_id,
      fs.amount_net,
      fs.patient_phone,
      COALESCE(fs.intake_at, fs.settled_at, fs.created_at) AS event_at,
      LOWER(TRANSLATE(COALESCE(fs.template_name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS subject_norm
    FROM public.financial_settlements fs
    WHERE fs.clinic_id = v_clinic_id
      AND fs.cancelled_at IS NULL
  ),
  matched_events AS (
    SELECT DISTINCT
      sl.id AS lead_id,
      sb.id AS settlement_id,
      sb.amount_net,
      sb.event_at,
      (sb.subject_norm LIKE '%valoraci%' OR sb.subject_norm LIKE '%primera%') AS is_appointment
    FROM scoped_leads sl
    JOIN settlement_base sb ON sb.clinic_id = sl.clinic_id
    WHERE 
      -- ROBUST PHONE MATCH (Last 9 digits)
      public.normalize_phone_robust(sl.phone) = public.normalize_phone_robust(sb.patient_phone)
      OR public.normalize_phone_robust(sl.phone_normalized) = public.normalize_phone_robust(sb.patient_phone)
  ),
  revenue_summary AS (
    SELECT lead_id, SUM(COALESCE(amount_net, 0)) AS total_rev, MIN(event_at) AS first_ev
    FROM matched_events
    GROUP BY lead_id
  ),
  updated AS (
    UPDATE public.leads l
    SET
      verified_revenue = GREATEST(COALESCE(l.verified_revenue, 0), rs.total_rev),
      appointment_date = COALESCE(l.appointment_date, rs.first_ev),
      updated_at = NOW()
    FROM revenue_summary rs
    WHERE l.id = rs.lead_id
      AND (COALESCE(l.verified_revenue, 0) < rs.total_rev OR l.appointment_date IS NULL)
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN COALESCE(updated_count, 0);
END;
$$;

COMMIT;
