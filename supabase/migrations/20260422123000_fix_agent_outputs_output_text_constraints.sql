-- Fix agent_outputs.output_text compatibility with Edge Function inserts.
-- Some environments include output_text as NOT NULL without a default, while
-- the API historically inserted only JSON output.
-- This migration makes output_text safe in all environments and backfills nulls.

ALTER TABLE public.agent_outputs
  ADD COLUMN IF NOT EXISTS output_text TEXT;

UPDATE public.agent_outputs
SET output_text = COALESCE(output_text, '')
WHERE output_text IS NULL;

ALTER TABLE public.agent_outputs
  ALTER COLUMN output_text SET DEFAULT '';

ALTER TABLE public.agent_outputs
  ALTER COLUMN output_text DROP NOT NULL;
