-- =============================================================================
-- Remove replay-only duplicate agent_runs indexes.
--
-- The canonical production relation has one index each for execution_id and
-- playbook_id: idx_agent_runs_execution_id / idx_agent_runs_playbook_id.
-- Historical advisor migrations can create additional equivalent indexes during
-- a clean replay after the late-restored agent_runs baseline:
--   * 20260508120000 -> adv_fk_agent_runs_*
--   * 20260608150000 -> idx_agent_runs_*_fk
--
-- Those extra names do not exist in production and add avoidable write/storage
-- overhead. Drop only the known redundant replay artifacts after the canonical
-- indexes and foreign keys have been restored. Production application is a no-op
-- for names that are absent.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS public.adv_fk_agent_runs_execution_id;
DROP INDEX IF EXISTS public.adv_fk_agent_runs_playbook_id;
DROP INDEX IF EXISTS public.idx_agent_runs_execution_id_fk;
DROP INDEX IF EXISTS public.idx_agent_runs_playbook_id_fk;

COMMIT;
