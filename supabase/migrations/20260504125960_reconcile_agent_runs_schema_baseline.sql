-- =============================================================================
-- Restore the missing early baseline for public.agent_runs.
--
-- Production already contains this table, but its original CREATE TABLE is not
-- present in the versioned migration history. A clean Supabase replay reaches
-- the later playbooks baseline, whose guarded FK retrofit still resolves
-- public.agent_runs::regclass and therefore requires this relation to exist.
--
-- The two production foreign keys intentionally are NOT created here because
-- their targets (public.playbooks / public.playbook_executions) are restored only
-- by 20260823213000. They are finalized by 20260823214000 after those relations
-- exist. This keeps the historical replay acyclic without rewriting any applied
-- migration.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL,
  user_id uuid NOT NULL,
  playbook_id uuid,
  status text NOT NULL DEFAULT 'running'::text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT agent_runs_status_check
    CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'dead_letter'::text]))
);

-- Reconcile columns idempotently for an already-existing partial relation while
-- preserving production data. Fresh replays receive the same definitions above.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS playbook_id uuid,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'running'::text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_runs'::regclass
      AND conname = 'agent_runs_status_check'
  ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_status_check
      CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'dead_letter'::text]));
  END IF;
END;
$do$;

CREATE INDEX IF NOT EXISTS agent_runs_created_at_idx
  ON public.agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_user_id_idx
  ON public.agent_runs (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_execution_id
  ON public.agent_runs (execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_playbook_id
  ON public.agent_runs (playbook_id);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_runs_service_role ON public.agent_runs;
CREATE POLICY agent_runs_service_role
  ON public.agent_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Production grants API roles table privileges and relies on RLS for row access.
GRANT ALL ON TABLE public.agent_runs TO anon, authenticated, service_role;

COMMIT;
