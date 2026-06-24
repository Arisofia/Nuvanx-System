-- =============================================================================
-- Historical intermediate vw_campaign_performance_real improvement.
-- =============================================================================
-- The actual compatible view recreation lives in
-- 20260604000000_final_vw_campaign_performance_real.sql. This migration is kept
-- as a no-op to avoid CREATE OR REPLACE VIEW column-order/name conflicts with
-- earlier versions of public.vw_campaign_performance_real.

DO $$
BEGIN
  RAISE NOTICE 'Skipping superseded vw_campaign_performance_real improvement; final view recreation runs in 20260604000000.';
END $$;
