-- Add compatibility columns for reported agent_outputs fields
-- This migration adds `input_context` and `output_data` so the persisted
-- agent_outputs schema matches the fields previously claimed in reports.

ALTER TABLE public.agent_outputs
  ADD COLUMN IF NOT EXISTS input_context TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS output_data JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agent_outputs.input_context IS 'Optional input context provided to the agent.';
COMMENT ON COLUMN public.agent_outputs.output_data IS 'Raw output payload for compatibility with legacy reporting fields.';
