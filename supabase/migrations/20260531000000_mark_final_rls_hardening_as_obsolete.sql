-- 20260531000000_mark_final_rls_hardening_as_obsolete.sql
--
-- Purpose:
--   Explicitly documents that migration 20260523090000_final_rls_hardening.sql
--   is considered obsolete and superseded by later, more complete RLS hardening migrations
--   (especially 20260522100000 and 20260529/20260530 series).
--
-- Rationale:
--   The original file only touched a few tables and created an unused helper (is_service_role()).
--   Its intent has been better covered by subsequent migrations with more consistent patterns,
--   better use of (SELECT auth.*()) wrappers, and stronger role separation.

DO $$
BEGIN
  RAISE NOTICE '=============================================================================';
  RAISE NOTICE 'Migration 20260523090000_final_rls_hardening.sql is marked as OBSOLETE.';
  RAISE NOTICE '';
  RAISE NOTICE 'Its effects were superseded by:';
  RAISE NOTICE '  - 20260522100000_final_security_hardening.sql';
  RAISE NOTICE '  - 20260529000000_fix_remaining_auth_rls_initplan.sql';
  RAISE NOTICE '  - 20260530000000_comprehensive_rls_fix.sql';
  RAISE NOTICE '';
  RAISE NOTICE 'The helper function public.is_service_role() is unused and can be dropped.';
  RAISE NOTICE '=============================================================================';
END $$;

-- Remove the dead helper if it still exists
DROP FUNCTION IF EXISTS public.is_service_role();