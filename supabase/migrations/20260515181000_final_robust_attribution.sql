-- =============================================================================
-- Final Robust Attribution Fix (Proven by Diagnostic)
--
-- This migration implements the EXACT matching logic that successfully found
-- intersections in the diagnostic run (last 9 digits of phone).
-- =============================================================================

BEGIN;

-- 1. Ensure the robust normalization function is strictly 9-digits only for Spain
CREATE OR REPLACE FUNCTION public.normalize_phone_9digits(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  digits TEXT;
BEGIN
  IF p_phone IS NULL THEN RETURN NULL; END IF;
  
  -- Extract only digits
  digits := regexp_replace(p_phone, '[^0-9]', '', 'g');
  
  -- Use last 9 digits (canonical Spanish format)
  IF length(digits) >= 9 THEN
    RETURN RIGHT(digits, 9);
  END IF;
  
  RETURN NULLIF(digits, '');
END;
$$;

-- 2. Update existing data to have these 9-digits for fast indexing
UPDATE public.leads SET phone_normalized = public.normalize_phone_9digits(phone) WHERE phone IS NOT NULL;
UPDATE public.financial_settlements SET phone_normalized = public.normalize_phone_9digits(patient_phone) WHERE patient_phone IS NOT NULL;

-- 3. Simplified Reconciliation RPC (The one that found 2 matches in diagnostic)
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
  -- Get clinic_id for the user
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  -- DIRECT ATTRIBUTION: Match Leads to Settlements by 9-digit phone
  WITH matched_revenue AS (
    SELECT 
      l.id AS lead_id,
      SUM(COALESCE(fs.amount_net, 0)) AS total_rev,
      MIN(COALESCE(fs.intake_at, fs.settled_at)) AS first_ev
    FROM public.leads l
    JOIN public.financial_settlements fs ON (
      -- The magical 9-digit match proven by diagnostic
      public.normalize_phone_9digits(l.phone) = public.normalize_phone_9digits(fs.patient_phone)
    )
    WHERE l.clinic_id = v_clinic_id
      AND fs.clinic_id = v_clinic_id
      AND l.phone IS NOT NULL
      AND fs.patient_phone IS NOT NULL
      AND fs.cancelled_at IS NULL
    GROUP BY l.id
  )
  UPDATE public.leads l
  SET
    verified_revenue = GREATEST(COALESCE(l.verified_revenue, 0), mr.total_rev),
    appointment_date = COALESCE(l.appointment_date, mr.first_ev),
    stage = CASE 
      WHEN l.stage IN ('lead', 'whatsapp') AND mr.first_ev IS NOT NULL THEN 'appointment'
      ELSE l.stage
    END,
    updated_at = NOW()
  FROM matched_revenue mr
  WHERE l.id = mr.lead_id
    AND (COALESCE(l.verified_revenue, 0) < mr.total_rev OR l.appointment_date IS NULL)
  RETURNING l.id INTO updated_count;

  RETURN COALESCE(updated_count, 0);
END;
$$;

-- 4. Update the individual matching function for manual calls
CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- We now use the main reconciliation function as it is the most robust
  RETURN public.reconcile_doctoralia_subjects_to_leads(p_user_id);
END;
$$;

COMMIT;
