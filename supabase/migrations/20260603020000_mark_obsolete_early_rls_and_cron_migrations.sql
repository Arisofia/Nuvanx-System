-- =============================================================================
-- Mark early/obsolete RLS and cron migrations as historical
-- These files are kept for audit history but should not be reapplied in clean deploys.
-- =============================================================================

-- The following migrations are considered obsolete / superseded (as of 2026-06-03):
--   20260523090000_*
--   20260507170000_*
--   20260521100000_*
--   Various early cron/anon RLS duplicates (e.g. 20260528xxx series partial duplicates)

-- This migration serves as documentation + a safe "no-op" marker.
-- No structural changes are performed here.

DO $$
BEGIN
  RAISE NOTICE 'Marking early RLS/cron migrations as obsolete (see comments in this file).';
  RAISE NOTICE 'Obsolete list: 20260523090000, 20260507170000, 20260521100000 and early cron duplicates.';
END $$;
