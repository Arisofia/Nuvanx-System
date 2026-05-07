-- =============================================================================
-- Harden agent_outputs INSERT policy against anonymous sign-in sessions.
--
-- Root cause:
--   agent_outputs_insert_own (created in 20260419103000 and 20260419145000)
--   allows any TO authenticated user to INSERT rows. Anonymous sign-in sessions
--   (role = authenticated, JWT is_anonymous = true) match the policy because
--   there is no is_anonymous guard, unlike the SELECT policy which was hardened
--   in 20260422110000_fix_anon_access_agent_outputs_meta_cache.sql.
--
-- Risk:
--   A user with Supabase Anonymous Sign-In enabled can call
--   POST /rest/v1/agent_outputs with user_id = auth.uid() and insert noise
--   into the table. They cannot read other users' rows (SELECT is guarded), but
--   the INSERT creates orphaned rows from meaningless sessions.
--
-- Fix:
--   Recreate the INSERT WITH CHECK to include the same is_anonymous guard that
--   the SELECT policy already uses.
-- =============================================================================

DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
CREATE POLICY agent_outputs_insert_own
  ON public.agent_outputs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    AND auth.uid() = user_id
  );
