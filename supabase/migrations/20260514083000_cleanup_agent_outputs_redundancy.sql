-- Cleanup redundant agent_outputs columns
-- output_data is a duplicate of output (jsonb)
ALTER TABLE public.agent_outputs DROP COLUMN IF EXISTS output_data;

-- Optional: Add comment to clarify output_text usage
COMMENT ON COLUMN public.agent_outputs.output_text IS 'Textual representation of the agent output, used for context memory.';
COMMENT ON COLUMN public.agent_outputs.output IS 'Canonical structured agent output payload (JSONB).';
