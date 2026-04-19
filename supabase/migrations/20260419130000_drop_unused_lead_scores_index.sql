-- Drop unused lead_scores_created_at_idx
-- This index was created in 20260419120000_durable_execution_core.sql but is not being used by any queries.
-- No SELECT queries in the codebase filter or order by created_at on lead_scores.
-- Can be recreated if needed in the future.

DROP INDEX IF EXISTS public.lead_scores_created_at_idx;
