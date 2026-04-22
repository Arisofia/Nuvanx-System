-- Align agent_outputs schema with Edge Function payload contracts
-- The API persists structured JSON into `output` and `metadata`.

ALTER TABLE public.agent_outputs
  ADD COLUMN IF NOT EXISTS output JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agent_outputs.output IS 'Structured agent output payload persisted by Edge Function';
COMMENT ON COLUMN public.agent_outputs.metadata IS 'Execution metadata and traceability fields for agent outputs';
