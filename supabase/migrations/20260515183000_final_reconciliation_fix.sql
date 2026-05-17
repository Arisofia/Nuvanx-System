-- =============================================================================
-- Final Reconciliation Fix: Phone-First Strategy
-- =============================================================================

BEGIN;

-- 1. Create a super-robust reconciliation function that ignores clinic_id mismatches 
-- if the phone is a perfect 9-digit match (since clinic_id might be missing in some imports)
CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_subjects_to_leads(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER -- Use DEFINER to bypass RLS and fix data across tables
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
  v_clinic_id UUID;
BEGIN
  -- Get clinic_id for the user
  SELECT clinic_id INTO v_clinic_id FROM public.users WHERE id = p_user_id;
  IF v_clinic_id IS NULL THEN RETURN 0; END IF;

  -- First, fix any null clinic_ids in settlements if they match a lead's phone
  UPDATE public.financial_settlements fs
  SET clinic_id = l.clinic_id
  FROM public.leads l
  WHERE fs.clinic_id IS NULL
    AND fs.phone_normalized = l.phone_normalized
    AND l.clinic_id IS NOT NULL;

  -- Also fix any null clinic_ids in leads if they match a settlement's phone
  -- This "adopts" orphan leads into the correct clinic for attribution
  UPDATE public.leads l
  SET clinic_id = fs.clinic_id
  FROM public.financial_settlements fs
  WHERE l.clinic_id IS NULL
    AND l.phone_normalized = fs.phone_normalized
    AND fs.clinic_id IS NOT NULL;

  -- Fix any null clinic_ids in produccion_intermediarios if they match a lead's phone
  UPDATE public.produccion_intermediarios pi
  SET clinic_id = l.clinic_id
  FROM public.leads l
  WHERE pi.clinic_id IS NULL
    AND pi.phone_normalized = l.phone_normalized
    AND l.clinic_id IS NOT NULL;

  -- Now execute the attribution
  WITH matched_revenue AS (
    SELECT 
      l.id AS lead_id,
      SUM(COALESCE(fs.amount_net, 0)) AS total_rev,
      MIN(COALESCE(fs.intake_at, fs.settled_at)) AS first_ev
    FROM public.leads l
    JOIN public.financial_settlements fs ON l.phone_normalized = fs.phone_normalized
    WHERE l.clinic_id = v_clinic_id
      AND (fs.clinic_id = v_clinic_id OR fs.clinic_id IS NULL)
      AND l.phone_normalized IS NOT NULL
      AND fs.cancelled_at IS NULL
    GROUP BY l.id
  )
  UPDATE public.leads l
  SET
    verified_revenue = mr.total_rev,
    appointment_date = COALESCE(l.appointment_date, mr.first_ev),
    stage = CASE 
      WHEN l.stage IN ('lead', 'whatsapp', 'appointment') AND mr.total_rev > 0 THEN 'convertido'
      ELSE l.stage
    END,
    updated_at = NOW()
  FROM matched_revenue mr
  WHERE l.id = mr.lead_id
    AND (COALESCE(l.verified_revenue, 0) != mr.total_rev OR l.stage != 'convertido')
  ;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- 2. Run it once for the admin user to apply changes immediately
-- (We use the user_id from the diagnostic log if possible, or just create a task)
-- For now, we leave it as a function to be called by the API.

COMMIT;
