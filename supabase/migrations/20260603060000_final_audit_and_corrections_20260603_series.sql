-- =============================================================================
-- Final Audit & Corrections for the 20260603xxxx hardening series
-- =============================================================================

-- 1. Ensure handle_updated_at (or set_updated_at) is properly hardened
-- (The function created in 20260603040000 should already have search_path,
-- but we re-apply it here for safety in case of ordering issues)

DO $$
BEGIN
  -- Re-hardens the trigger function if it exists
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('set_updated_at', 'handle_updated_at')
  ) THEN
    -- Try both common names
    BEGIN
      ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_catalog;
    EXCEPTION WHEN undefined_function THEN
      -- Function may be named differently, ignore
    END;

    BEGIN
      ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_catalog;
    EXCEPTION WHEN undefined_function THEN
      -- ignore
    END;

    RAISE NOTICE 'Hardened search_path on updated_at trigger functions';
  END IF;
END $$;

-- 2. Final confirmation that obsolete migrations are documented
-- (See 20260603020000_mark_obsolete_early_rls_and_cron_migrations.sql for the list)

-- 3. Ensure the consolidated helpers from 20260603000000 are the canonical ones
-- (No-op here, just a marker for the audit)

-- 4. Minor safety: Re-apply search_path to the two most critical functions
-- in case any previous migration overrode them.

ALTER FUNCTION IF EXISTS public.normalize_phone(TEXT) SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.run_doctoralia_name_match() SET search_path = public, pg_catalog;
ALTER FUNCTION IF EXISTS public.current_clinic_id() SET search_path = pg_catalog, public;
ALTER FUNCTION IF EXISTS public.current_user_id() SET search_path = pg_catalog, public;

-- End of 20260603 series audit
COMMENT ON SCHEMA public IS 
  'Schema hardened during 20260603 series: RLS consolidated, helpers with proper search_path, CAPI columns added, obsolete migrations documented.';
