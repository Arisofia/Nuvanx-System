-- =============================================================================
-- Enable and harden RLS for public.clinics (PostgREST-exposed schema)
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.clinics') IS NULL THEN
    RAISE NOTICE 'Skipping clinics RLS hardening: public.clinics does not exist';
    RETURN;
  END IF;

  ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

  -- API grants are explicit; RLS policies still gate row access.
  GRANT SELECT ON public.clinics TO authenticated;
  GRANT ALL ON public.clinics TO service_role;

  DROP POLICY IF EXISTS clinics_select_clinic ON public.clinics;
  CREATE POLICY clinics_select_clinic
    ON public.clinics
    FOR SELECT
    TO authenticated
    USING (id = (SELECT public.current_clinic_id()));

  DROP POLICY IF EXISTS clinics_service_role ON public.clinics;
  CREATE POLICY clinics_service_role
    ON public.clinics
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
END $$;
