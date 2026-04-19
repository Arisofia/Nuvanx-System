-- Fix lint 0012_auth_allow_anonymous_sign_ins for public.audit_log and public.leads
-- The existing TO authenticated RESTRICTIVE deny policies cover anonymous sign-in
-- sessions (authenticated role, is_anonymous=true in JWT), but the linter also
-- flags tables when a permissive TO public policy (like audit_log_insert_only) grants
-- access to the anon role. Add explicit deny-all TO anon RESTRICTIVE policies
-- so only the anon role is blocked at the RLS layer; service_role is unaffected
-- because it bypasses RLS entirely.

DO $$
BEGIN
  -- audit_log: deny all access to the anon role
  DROP POLICY IF EXISTS audit_log_deny_all_public ON public.audit_log;
  DROP POLICY IF EXISTS audit_log_deny_all_anon   ON public.audit_log;
  CREATE POLICY audit_log_deny_all_anon
    ON public.audit_log
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

  -- leads: deny all access to the anon role
  DROP POLICY IF EXISTS leads_deny_all_public ON public.leads;
  DROP POLICY IF EXISTS leads_deny_all_anon   ON public.leads;
  CREATE POLICY leads_deny_all_anon
    ON public.leads
    AS RESTRICTIVE
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);
END $$;
