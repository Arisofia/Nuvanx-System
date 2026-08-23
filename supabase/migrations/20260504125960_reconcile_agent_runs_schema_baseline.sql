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
--
-- Partial-table safety: if agent_runs already exists, this migration reconciles
-- its complete production contract. It never invents required historical values:
-- incompatible types, NULLs in required columns, a non-canonical primary key, or
-- invalid status values fail with an explicit diagnostic instead of allowing a
-- weaker schema to continue replay.
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

-- Add every production column without silently backfilling pre-existing rows.
-- Defaults and NOT NULL constraints are restored only after validating that an
-- existing partial relation already contains valid required data.
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS playbook_id uuid,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

DO $do$
DECLARE
  expected RECORD;
  actual_udt text;
  primary_key_name text;
  primary_key_definition text;
BEGIN
  -- Fail clearly instead of attempting unsafe implicit casts on partial tables.
  FOR expected IN
    SELECT * FROM (VALUES
      ('id', 'uuid'),
      ('execution_id', 'uuid'),
      ('user_id', 'uuid'),
      ('playbook_id', 'uuid'),
      ('status', 'text'),
      ('metadata', 'jsonb'),
      ('error', 'text'),
      ('created_at', 'timestamptz'),
      ('completed_at', 'timestamptz')
    ) AS contract(column_name, udt_name)
  LOOP
    SELECT c.udt_name
      INTO actual_udt
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'agent_runs'
      AND c.column_name = expected.column_name;

    IF actual_udt IS DISTINCT FROM expected.udt_name THEN
      RAISE EXCEPTION
        'Cannot reconcile public.agent_runs: column % has type %, expected %',
        expected.column_name, COALESCE(actual_udt, '<missing>'), expected.udt_name;
    END IF;
  END LOOP;

  -- Required historical identifiers/timestamps cannot be inferred safely. A
  -- partial non-empty table missing them must stop replay rather than fabricate
  -- values that could corrupt lineage.
  IF EXISTS (SELECT 1 FROM public.agent_runs WHERE id IS NULL) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: required id contains NULL values';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_runs WHERE execution_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: required execution_id contains NULL values';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_runs WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: required user_id contains NULL values';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_runs WHERE status IS NULL) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: required status contains NULL values';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_runs WHERE metadata IS NULL) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: required metadata contains NULL values';
  END IF;
  IF EXISTS (SELECT 1 FROM public.agent_runs WHERE created_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: required created_at contains NULL values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agent_runs
    GROUP BY id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: duplicate id values prevent canonical primary key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agent_runs
    WHERE status <> ALL (ARRAY['running'::text, 'success'::text, 'failed'::text, 'dead_letter'::text])
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile public.agent_runs: status contains values outside the production contract';
  END IF;

  SELECT con.conname, pg_get_constraintdef(con.oid)
    INTO primary_key_name, primary_key_definition
  FROM pg_constraint con
  WHERE con.conrelid = 'public.agent_runs'::regclass
    AND con.contype = 'p';

  IF primary_key_name IS NULL THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);
  ELSIF primary_key_name <> 'agent_runs_pkey'
     OR primary_key_definition <> 'PRIMARY KEY (id)' THEN
    RAISE EXCEPTION
      'Cannot reconcile public.agent_runs: primary key is % (%), expected agent_runs_pkey PRIMARY KEY (id)',
      primary_key_name, primary_key_definition;
  END IF;
END;
$do$;

ALTER TABLE public.agent_runs
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN execution_id SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'running'::text,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

DO $do$
DECLARE
  status_definition text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO status_definition
  FROM pg_constraint
  WHERE conrelid = 'public.agent_runs'::regclass
    AND conname = 'agent_runs_status_check';

  IF status_definition IS NULL THEN
    ALTER TABLE public.agent_runs
      ADD CONSTRAINT agent_runs_status_check
      CHECK (status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text, 'dead_letter'::text]));
  ELSIF status_definition <> 'CHECK ((status = ANY (ARRAY[''running''::text, ''success''::text, ''failed''::text, ''dead_letter''::text])))' THEN
    RAISE EXCEPTION
      'Cannot reconcile public.agent_runs: agent_runs_status_check differs from production contract: %',
      status_definition;
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
