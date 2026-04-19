-- Migration 008: Rename figma_tokens → design_tokens
-- This table stores KPI data synced by figmaSync; the name "figma_tokens" is misleading
-- because it holds general design system / KPI tokens, not Figma-specific authentication tokens.

ALTER TABLE IF EXISTS figma_tokens RENAME TO design_tokens;

-- Update any RLS policies that reference the old table name (policy names stay the same)
-- Policies are automatically carried over with ALTER TABLE RENAME.

DO $$
BEGIN
  IF to_regclass('public.design_tokens') IS NOT NULL THEN
    COMMENT ON TABLE public.design_tokens IS 'Design-system KPI tokens synced from the backend figmaSync service.';
  END IF;
END $$;
