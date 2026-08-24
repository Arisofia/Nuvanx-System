-- Fix the anonymous-authenticated guard on playbook_executions.
--
-- The prior guard was created AS PERMISSIVE alongside playbook_executions_user.
-- PostgreSQL ORs permissive policies, so any non-anonymous authenticated user
-- could satisfy the broad guard without also satisfying user_id ownership.
-- Recreate only this guard as RESTRICTIVE so ownership remains enforced by the
-- existing playbook_executions_user policy.

DROP POLICY IF EXISTS deny_anonymous_authenticated
ON public.playbook_executions;

CREATE POLICY deny_anonymous_authenticated
ON public.playbook_executions
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false
)
WITH CHECK (
  COALESCE((((SELECT auth.jwt()) ->> 'is_anonymous'))::boolean, false) = false
);
