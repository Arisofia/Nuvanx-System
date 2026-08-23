-- =============================================================================
-- Finalize public.agent_runs after the playbooks baseline exists.
--
-- 20260504125960 restores agent_runs early enough for historical replay, but it
-- cannot safely create its production foreign keys before playbooks and
-- playbook_executions exist. 20260823213000 restores those target relations and
-- may add the playbook FK itself; this migration idempotently completes both FKs
-- without modifying that already-applied migration.
-- =============================================================================

BEGIN;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_runs'::regclass
      AND conname = 'agent_runs_execution_id_fkey'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_execution_id_fkey
      FOREIGN KEY (execution_id)
      REFERENCES public.playbook_executions(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_runs'::regclass
      AND conname = 'agent_runs_playbook_id_fkey'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_playbook_id_fkey
      FOREIGN KEY (playbook_id)
      REFERENCES public.playbooks(id)
      ON DELETE SET NULL;
  END IF;
END;
$do$;

COMMIT;
