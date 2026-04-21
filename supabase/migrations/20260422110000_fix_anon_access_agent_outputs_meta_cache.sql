-- =============================================================================
-- Fix anonymous-access advisor warnings (lint 0012_auth_allow_anonymous_sign_ins)
-- Affected tables: public.agent_outputs, public.meta_cache
-- =============================================================================
-- Supabase flags any TO authenticated policy whose USING clause does not
-- explicitly exclude anonymous sessions (JWT is_anonymous = true).
-- Pattern used throughout this repo:
--   AND COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
-- =============================================================================

-- ── 1. agent_outputs: add is_anonymous guard to clinic-read policy ───────────
DROP POLICY IF EXISTS agent_outputs_select_clinic ON public.agent_outputs;

CREATE POLICY agent_outputs_select_clinic
  ON public.agent_outputs
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    AND (
      (SELECT auth.uid()) = user_id
      OR clinic_id = (((SELECT auth.jwt()) ->> 'clinic_id'::text))::uuid
    )
  );

-- ── 2. meta_cache: add is_anonymous guard to owner-read policy ───────────────
-- Drop both possible definitions (original migration + PK-fix migration both
-- created a policy with this name).
DROP POLICY IF EXISTS meta_cache_select_own    ON public.meta_cache;
DROP POLICY IF EXISTS meta_cache_upsert_service ON public.meta_cache;
DROP POLICY IF EXISTS meta_cache_service_role  ON public.meta_cache;

CREATE POLICY meta_cache_select_own ON public.meta_cache
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    AND auth.uid() = user_id
  );

-- Service role retains unrestricted write access (Edge Function)
CREATE POLICY meta_cache_service_role ON public.meta_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
