-- =============================================================================
-- Legacy campaign ROI refinement migration.
--
-- Superseded by 20260518120000_restore_campaign_roi_after_traceability_views.sql,
-- which owns the canonical get_campaign_roi definition after all traceability view
-- rebuilds. This file intentionally does not recreate the function so CI/preview
-- databases do not resolve vw_lead_traceability before the canonical migration.
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Skipping legacy get_campaign_roi refinement; canonical definition is restored in 20260518120000_restore_campaign_roi_after_traceability_views.sql.';
END $$;
