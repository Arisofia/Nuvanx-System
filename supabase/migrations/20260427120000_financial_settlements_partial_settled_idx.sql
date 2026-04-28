-- =============================================================================
-- Query Performance: Partial index for active financial settlements by clinic
-- =============================================================================
-- This index speeds up queries that filter by clinic_id and exclude cancelled
-- settlements, especially when ordering by settled_at.
--
-- Example coverage:
--   WHERE clinic_id =  AND cancelled_at IS NULL
--   ORDER BY settled_at DESC
-- =============================================================================

CREATE INDEX IF NOT EXISTS settlements_clinic_settled_idx
  ON public.financial_settlements (clinic_id, settled_at DESC)
  WHERE cancelled_at IS NULL;

ANALYZE public.financial_settlements;

