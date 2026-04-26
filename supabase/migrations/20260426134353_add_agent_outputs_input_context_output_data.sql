-- Align agent_outputs with Edge Function persistAgentOutput() contract
-- Adding input_context and output_data for full traceability of AI runs.

ALTER TABLE public.agent_outputs
  ADD COLUMN IF NOT EXISTS input_context TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS output_data JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.agent_outputs.input_context IS 'Full prompt context or relevant source data used for the agent run';
COMMENT ON COLUMN public.agent_outputs.output_data IS 'Structured JSON copy of the result (duplicate of output for backward compatibility with legacy reporting views)';
