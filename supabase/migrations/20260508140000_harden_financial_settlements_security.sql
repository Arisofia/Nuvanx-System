-- =============================================================================
-- Harden security for financial_settlements
-- (Option C3 - 08-05-2026)
--
-- 1. Explicitly deny INSERT, UPDATE, DELETE for clinics (read-only table)
-- 2. Revoke table-level permissions for anon and authenticated roles
-- 3. Ensure RLS is active and covers all operations
-- =============================================================================

-- 1. Ensure RLS is enabled (should already be, but safe to repeat)
ALTER TABLE public.financial_settlements ENABLE ROW LEVEL SECURITY;

-- 2. Drop any broad non-SELECT policies if they exist (clean slate for write operations)
DROP POLICY IF EXISTS settlements_insert_clinic ON public.financial_settlements;
DROP POLICY IF EXISTS settlements_update_clinic ON public.financial_settlements;
DROP POLICY IF EXISTS settlements_delete_clinic ON public.financial_settlements;

-- 3. Revoke write permissions from public/anon/authenticated roles
-- This ensures even if a policy is accidentally added, the DB permissions act as a second wall.
REVOKE INSERT, UPDATE, DELETE ON public.financial_settlements FROM anon, authenticated, public;

-- 4. Re-grant SELECT but keep it restricted via RLS
GRANT SELECT ON public.financial_settlements TO authenticated;

-- 5. Ensure the SELECT policy is the only one available for clinic users
-- (service_role ignores RLS and can still perform maintenance/ingestion)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'financial_settlements' AND policyname = 'financial_settlements_select_clinic'
  ) THEN
    -- If the current name doesn't exist, we ensure the standardized version from 20260502110000 is there
    DROP POLICY IF EXISTS settlements_select_clinic ON public.financial_settlements;
    CREATE POLICY financial_settlements_select_clinic ON public.financial_settlements
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND clinic_id = public.current_clinic_id()
      );
  END IF;
END $$;

-- 6. Add a log entry for security auditing
COMMENT ON TABLE public.financial_settlements IS 'Verified revenue records. Read-only for clinics. Hardened 2026-05-08.';
