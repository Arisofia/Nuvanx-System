-- =============================================================================
-- Fix agent_outputs: output_text column hardening
-- =============================================================================
-- Problem: output_text was NOT NULL without a default, causing 500 errors
-- during persistAgentOutput when the column was not provided.
-- Fix: ensure column exists, drop NOT NULL constraint, and set default.
-- =============================================================================

DO $$
BEGIN
    -- 1. Ensure the column exists (in case it was missing in local schema)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'agent_outputs' 
          AND column_name = 'output_text'
    ) THEN
        ALTER TABLE public.agent_outputs ADD COLUMN output_text TEXT;
    END IF;

    -- 2. Drop NOT NULL if it was set
    ALTER TABLE public.agent_outputs ALTER COLUMN output_text DROP NOT NULL;

    -- 3. Set default to empty string to avoid NULLs where undesired
    ALTER TABLE public.agent_outputs ALTER COLUMN output_text SET DEFAULT '';
END $$;
