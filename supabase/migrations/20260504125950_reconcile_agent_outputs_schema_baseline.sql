-- =============================================================================
-- Restore the missing canonical baseline for public.agent_outputs.
--
-- Production already contains this relation, but its original CREATE TABLE is
-- absent from the versioned migration history. Fresh Supabase Preview/replay
-- databases therefore need the table before historical migrations and the later
-- playbooks baseline can reference it.
--
-- Ordering is deliberate:
--   * 20260501090000 provides the preview-compatible public.users table;
--   * 20260501190000 provides public.current_clinic_id();
--   * 20260504125900 provides the preview-compatible public.clinics table;
--   * this migration then creates agent_outputs before every later versioned
--     migration that references it.
--
-- Production uses `supabase db push --include-all`, so this late-added earlier
-- version can be recorded without rewriting an already-applied migration.
-- Existing rows are preserved. `output_data` is restored only as a compatibility
-- column because the currently deployed agent-run v106 and the repository caller
-- still read/write it, while `output` + `metadata` remain the canonical fields.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  clinic_id uuid,
  agent_type varchar NOT NULL,
  prompt_hash varchar,
  input_context jsonb DEFAULT '{}'::jsonb,
  output_text text DEFAULT ''::text,
  output_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_used varchar,
  tokens_used integer DEFAULT 0,
  status varchar DEFAULT 'completed'::varchar,
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT agent_outputs_status_check
    CHECK ((status)::text = ANY ((ARRAY[
      'pending'::varchar,
      'running'::varchar,
      'completed'::varchar,
      'failed'::varchar
    ])::text[]))
);

-- Production currently lacks this legacy compatibility column even though the
-- deployed standalone agent-run still uses it. Adding it is idempotent and keeps
-- the canonical output/metadata fields unchanged.
ALTER TABLE public.agent_outputs
  ADD COLUMN IF NOT EXISTS output_data jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_outputs'::regclass
      AND conname = 'agent_outputs_status_check'
  ) THEN
    ALTER TABLE public.agent_outputs
      ADD CONSTRAINT agent_outputs_status_check
      CHECK ((status)::text = ANY ((ARRAY[
        'pending'::varchar,
        'running'::varchar,
        'completed'::varchar,
        'failed'::varchar
      ])::text[]));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_outputs'::regclass
      AND conname = 'agent_outputs_user_id_fkey'
  ) THEN
    ALTER TABLE public.agent_outputs
      ADD CONSTRAINT agent_outputs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.agent_outputs'::regclass
      AND conname = 'agent_outputs_clinic_id_fkey'
  ) THEN
    ALTER TABLE public.agent_outputs
      ADD CONSTRAINT agent_outputs_clinic_id_fkey
      FOREIGN KEY (clinic_id) REFERENCES public.clinics(id);
  END IF;
END;
$do$;

CREATE INDEX IF NOT EXISTS agent_outputs_created_at_idx
  ON public.agent_outputs (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_outputs_user_id_idx
  ON public.agent_outputs (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_clinic_id
  ON public.agent_outputs (clinic_id);

ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs;
CREATE POLICY agent_outputs_insert
  ON public.agent_outputs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) IS FALSE
    AND user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS agent_outputs_read_service ON public.agent_outputs;
CREATE POLICY agent_outputs_read_service
  ON public.agent_outputs
  FOR SELECT
  TO service_role
  USING ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS agent_outputs_select_clinic ON public.agent_outputs;
CREATE POLICY agent_outputs_select_clinic
  ON public.agent_outputs
  FOR SELECT
  TO authenticated
  USING (
    COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false
    AND clinic_id = (SELECT public.current_clinic_id())
  );

DROP POLICY IF EXISTS agent_outputs_service_all ON public.agent_outputs;
CREATE POLICY agent_outputs_service_all
  ON public.agent_outputs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS agent_outputs_service_role_only ON public.agent_outputs;
CREATE POLICY agent_outputs_service_role_only
  ON public.agent_outputs
  FOR ALL
  TO service_role
  USING ((SELECT auth.role()) = 'service_role'::text)
  WITH CHECK ((SELECT auth.role()) = 'service_role'::text);

DROP POLICY IF EXISTS deny_anonymous_authenticated ON public.agent_outputs;
CREATE POLICY deny_anonymous_authenticated
  ON public.agent_outputs
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false)
  WITH CHECK (COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false);

REVOKE ALL ON TABLE public.agent_outputs FROM anon;
GRANT ALL ON TABLE public.agent_outputs TO authenticated, service_role;

COMMIT;
