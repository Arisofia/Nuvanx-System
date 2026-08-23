-- =============================================================================
-- Restore the missing canonical baseline for playbooks and playbook_executions.
--
-- Production already contains these relations, but the versioned migration
-- history starts after their original creation. This migration is therefore a
-- no-op for the healthy production schema and creates the production-equivalent
-- baseline on fresh/replay databases where the relations are absent.
--
-- The atomic run counter migration (20260823184500) intentionally skips trigger
-- creation when public.playbooks is absent. After creating the baseline here we
-- install the same trigger so a clean replay finishes with the production
-- execution-counting contract intact.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.playbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'General',
  status text NOT NULL DEFAULT 'draft',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  owner_user_id uuid,
  CONSTRAINT playbooks_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'draft'::text, 'archived'::text]))
);

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.playbooks'::regclass
      AND conname = 'playbooks_owner_user_id_fkey'
  ) THEN
    ALTER TABLE public.playbooks
      ADD CONSTRAINT playbooks_owner_user_id_fkey
      FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$do$;

CREATE INDEX IF NOT EXISTS idx_playbooks_owner_user_id
  ON public.playbooks (owner_user_id);

CREATE TABLE IF NOT EXISTS public.playbook_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'triggered',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  output_text text,
  output_data jsonb DEFAULT '{}'::jsonb,
  agent_output_id uuid,
  CONSTRAINT playbook_executions_status_check
    CHECK (status = ANY (ARRAY['triggered'::text, 'running'::text, 'success'::text, 'failed'::text, 'skipped'::text])),
  CONSTRAINT playbook_executions_playbook_id_fkey
    FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE CASCADE
);

DO $do$
BEGIN
  IF to_regclass('public.agent_outputs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.playbook_executions'::regclass
         AND conname = 'playbook_executions_agent_output_id_fkey'
     ) THEN
    ALTER TABLE public.playbook_executions
      ADD CONSTRAINT playbook_executions_agent_output_id_fkey
      FOREIGN KEY (agent_output_id) REFERENCES public.agent_outputs(id);
  END IF;
END;
$do$;

CREATE INDEX IF NOT EXISTS playbook_executions_created_at_idx
  ON public.playbook_executions (created_at DESC);
CREATE INDEX IF NOT EXISTS playbook_executions_playbook_id_idx
  ON public.playbook_executions (playbook_id);
CREATE INDEX IF NOT EXISTS playbook_executions_user_id_idx
  ON public.playbook_executions (user_id);
CREATE INDEX IF NOT EXISTS idx_playbook_executions_agent_output_id
  ON public.playbook_executions (agent_output_id);

-- Restore the incoming FK observed in production when agent_runs is present.
DO $do$
BEGIN
  IF to_regclass('public.agent_runs') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_attribute
       WHERE attrelid = 'public.agent_runs'::regclass
         AND attname = 'playbook_id'
         AND NOT attisdropped
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conrelid = 'public.agent_runs'::regclass
         AND conname = 'agent_runs_playbook_id_fkey'
     ) THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_playbook_id_fkey
      FOREIGN KEY (playbook_id) REFERENCES public.playbooks(id) ON DELETE SET NULL;
  END IF;
END;
$do$;

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbook_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS playbooks_service_role ON public.playbooks;
CREATE POLICY playbooks_service_role
  ON public.playbooks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS playbook_executions_service_role ON public.playbook_executions;
CREATE POLICY playbook_executions_service_role
  ON public.playbook_executions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS playbook_executions_user ON public.playbook_executions;
CREATE POLICY playbook_executions_user
  ON public.playbook_executions
  FOR ALL
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false
  );

DROP POLICY IF EXISTS deny_anonymous_authenticated ON public.playbook_executions;
CREATE POLICY deny_anonymous_authenticated
  ON public.playbook_executions
  FOR ALL
  TO authenticated
  USING (COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false)
  WITH CHECK (COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false);

-- Supabase production grants these API roles table privileges and relies on RLS
-- for row access. Preserve that observable contract on fresh/replay databases.
GRANT ALL ON TABLE public.playbooks TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.playbook_executions TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nvx_atomic_playbook_run_increment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  NEW.run_count := COALESCE(OLD.run_count, 0) + 1;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM anon;
REVOKE EXECUTE ON FUNCTION public.nvx_atomic_playbook_run_increment() FROM authenticated;

DROP TRIGGER IF EXISTS trg_playbooks_atomic_run_increment ON public.playbooks;
CREATE TRIGGER trg_playbooks_atomic_run_increment
BEFORE UPDATE OF last_run_at ON public.playbooks
FOR EACH ROW
EXECUTE FUNCTION public.nvx_atomic_playbook_run_increment();

COMMENT ON FUNCTION public.nvx_atomic_playbook_run_increment() IS
  'Internal trigger helper: increments playbooks.run_count from the locked OLD row whenever an execution advances last_run_at.';

COMMENT ON TRIGGER trg_playbooks_atomic_run_increment ON public.playbooks IS
  'Serializes playbook execution counters for every UPDATE targeting last_run_at; run_count-only administrative repairs remain explicit.';

COMMIT;
