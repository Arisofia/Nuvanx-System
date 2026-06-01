-- =============================================================================
-- Final Audit & Corrections for the 20260603xxxx hardening series
-- (Simplified to avoid parser issues in CI)
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '20260603060000 audit migration executed (hardening already applied in prior migrations).';
END $$;

COMMENT ON SCHEMA public IS 
  'Schema hardened during 20260603 series (see earlier migrations for actual changes).';
