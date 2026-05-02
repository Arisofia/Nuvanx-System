-- =============================================================================
-- Phase 3: SQL Hardening (RLS & SECURITY DEFINER)
-- 1. Create current_clinic_id() helper for secure RLS
-- 2. Update RLS policies to use current_clinic_id()
-- 3. Create api_call_log table for rate limiting
-- 4. Harden SECURITY DEFINER functions with search_path
-- =============================================================================

-- 1. Helper function for clinic-scoped RLS
CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_claim_clinic uuid;
  v_user_clinic uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    -- If not authenticated, we can't determine clinic
    RETURN NULL;
  END IF;

  -- Get clinic_id from JWT claim (if exists)
  BEGIN
    v_claim_clinic := (auth.jwt() ->> 'clinic_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_claim_clinic := NULL;
  END;

  -- Get clinic_id from users table (canonical source)
  SELECT clinic_id INTO v_user_clinic
  FROM public.users
  WHERE id = v_user_id;

  IF v_user_clinic IS NULL THEN
    RETURN NULL;
  END IF;

  -- If claim exists, it MUST match the database
  IF v_claim_clinic IS NOT NULL AND v_claim_clinic <> v_user_clinic THEN
    RAISE EXCEPTION 'Clinic claim mismatch';
  END IF;

  RETURN v_user_clinic;
END;
$$;

-- 2. Update RLS policies
-- Guard: ensure clinic_id columns exist on core tables (idempotent, safe to re-run)
-- These were added in 20260417100200 but the guard here protects against migration history divergence.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL;
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL;
ALTER TABLE public.credentials ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE SET NULL;

-- We drop and recreate policies that relied on direct JWT claim reading.

-- leads
DROP POLICY IF EXISTS leads_select_clinic ON public.leads;
CREATE POLICY leads_select_clinic ON public.leads
  FOR SELECT TO authenticated
  USING (clinic_id = public.current_clinic_id());

-- integrations
DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
CREATE POLICY integrations_select_clinic ON public.integrations
  FOR SELECT TO authenticated
  USING (clinic_id = public.current_clinic_id());

-- credentials
DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
CREATE POLICY credentials_select_clinic ON public.credentials
  FOR SELECT TO authenticated
  USING (clinic_id = public.current_clinic_id());

-- doctoralia_patients
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'doctoralia_patients') THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING (clinic_id = public.current_clinic_id());
  END IF;
END $$;

-- patients, doctors, treatment_types, appointments, financial_settlements, whatsapp_conversations
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['patients', 'doctors', 'treatment_types', 'appointments', 'financial_settlements', 'whatsapp_conversations'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format('CREATE POLICY %I_select_clinic ON public.%I FOR SELECT TO authenticated USING (clinic_id = public.current_clinic_id())', t, t);
    END IF;
  END LOOP;
END $$;

-- 3. api_call_log table for rate limiting
CREATE TABLE IF NOT EXISTS public.api_call_log (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint   VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_call_log_user_endpoint_idx ON public.api_call_log(user_id, endpoint, created_at DESC);

ALTER TABLE public.api_call_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
CREATE POLICY api_call_log_select_own ON public.api_call_log
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Harden SECURITY DEFINER functions
-- We ensure any function that might have been missed in Phase 2 is locked down.
DO $$
DECLARE
  fn_record RECORD;
BEGIN
  FOR fn_record IN
    SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    -- Fix search_path
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', fn_record.oid::regprocedure);
  END LOOP;
END $$;
