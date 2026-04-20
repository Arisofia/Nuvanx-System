-- Create agent_outputs table
-- This table stores the structured output of AI agent runs and is referenced
-- by the Supabase Advisor fix migration (150000) and multiple RLS/policy migrations.

CREATE TABLE IF NOT EXISTS public.agent_outputs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL,
  clinic_id   UUID        NULL REFERENCES public.clinics(id) ON DELETE SET NULL,
  agent_type  TEXT        NOT NULL DEFAULT 'ai',
  output      JSONB       NOT NULL DEFAULT '{}',
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_outputs_user_id_idx    ON public.agent_outputs(user_id);
CREATE INDEX IF NOT EXISTS agent_outputs_clinic_id_idx  ON public.agent_outputs(clinic_id);
CREATE INDEX IF NOT EXISTS agent_outputs_created_at_idx ON public.agent_outputs(created_at DESC);

ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

-- RLS policies — mirrors the policies defined (but guarded) in 20260419103000
DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
CREATE POLICY agent_outputs_insert_own
  ON public.agent_outputs
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS agent_outputs_select_own ON public.agent_outputs;
CREATE POLICY agent_outputs_select_own
  ON public.agent_outputs
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS agent_outputs_service_all ON public.agent_outputs;
CREATE POLICY agent_outputs_service_all
  ON public.agent_outputs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add agent_output_id FK column to playbook_executions so the FK index in
-- migration 20260419150000 (idx_playbook_executions_agent_output_id) can be created.
ALTER TABLE public.playbook_executions
  ADD COLUMN IF NOT EXISTS agent_output_id UUID NULL
    REFERENCES public.agent_outputs(id) ON DELETE SET NULL;
