-- =============================================================================
-- Final Audit & Corrections for the 20260603xxxx hardening series
-- =============================================================================

DO $$
BEGIN
  -- 1. Ensure handle_updated_at (or set_updated_at) is properly hardened
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('set_updated_at', 'handle_updated_at')
  ) THEN
    BEGIN
      ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_catalog;
    EXCEPTION WHEN undefined_function THEN
    END;

    BEGIN
      ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_catalog;
    EXCEPTION WHEN undefined_function THEN
    END;

    RAISE NOTICE 'Hardened search_path on updated_at trigger functions';
  END IF;

  -- 4. Minor safety: Re-apply search_path to the two most critical functions
  BEGIN
    ALTER FUNCTION IF EXISTS public.normalize_phone(TEXT) SET search_path = public, pg_catalog;
  EXCEPTION WHEN undefined_function THEN
  END;

  BEGIN
    ALTER FUNCTION IF EXISTS public.run_doctoralia_name_match() SET search_path = public, pg_catalog;
  EXCEPTION WHEN undefined_function THEN
  END;

  BEGIN
    ALTER FUNCTION IF EXISTS public.current_clinic_id() SET search_path = pg_catalog, public;
  EXCEPTION WHEN undefined_function THEN
  END;

  BEGIN
    ALTER FUNCTION IF EXISTS public.current_user_id() SET search_path = pg_catalog, public;
  EXCEPTION WHEN undefined_function THEN
  END;

  RAISE NOTICE 'Applied search_path hardening to critical helper functions';
END $$;

-- 2 & 3 are documentation only (see previous migration 20260603020000)

COMMENT ON SCHEMA public IS 
  'Schema hardened during 20260603 series: RLS consolidated, helpers with proper search_path, CAPI columns added, obsolete migrations documented.';
