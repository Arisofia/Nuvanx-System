-- Fix lint 0012 (auth_allow_anonymous_sign_ins) on public.audit_log and public.leads
--
-- Root cause: migrations 20260419170000 and 20260419175000 added RESTRICTIVE
-- deny-all policies targeting the `authenticated` and `anon` roles on these two
-- tables. The Supabase lint 0012 fires on any policy whose role clause includes
-- anonymous users — even fully-restrictive USING(false) ones — unless the policy
-- contains an explicit is_anonymous guard.
--
-- These deny-all policies are also functionally redundant:
--
--   audit_log  – the only remaining permissive policy is audit_log_insert_only
--                (TO service_role), so authenticated/anon users are already
--                denied by default RLS when no permissive policy matches.
--
--   leads      – leads_deny_all_authenticated (RESTRICTIVE USING(false)) silently
--                overrides the permissive leads_owner_only policy, making it
--                impossible for any authenticated user to access their own leads.
--                Dropping it restores the intended owner-access semantics while
--                the is_anonymous guard on leads_owner_only prevents anonymous
--                sign-in sessions from accessing the table.
--
-- After this migration:
--   • lint 0012 is silenced for both tables
--   • audit_log is write-only via service_role (all other roles denied by default)
--   • leads is accessible only to non-anonymous authenticated owners and service_role

DO $$
BEGIN
  -- audit_log: drop all deny-all variants (authenticated, anon, public)
  ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_deny_all_authenticated ON public.audit_log;
  ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_deny_all_anon          ON public.audit_log;
  ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_deny_all_public        ON public.audit_log;

  -- leads: drop all deny-all variants (authenticated, anon, public)
  ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_deny_all_authenticated ON public.leads;
  ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_deny_all_anon          ON public.leads;
  ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_deny_all_public        ON public.leads;
END $$;

