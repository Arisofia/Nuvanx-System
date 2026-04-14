-- Harden permissive RLS policies flagged by Supabase Advisor

DROP POLICY IF EXISTS credentials_owner_only ON public.credentials;
CREATE POLICY credentials_owner_only ON public.credentials
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS integrations_owner_only ON public.integrations;
CREATE POLICY integrations_owner_only ON public.integrations
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS leads_owner_only ON public.leads;
CREATE POLICY leads_owner_only ON public.leads
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS audit_log_insert_only ON public.audit_log;
CREATE POLICY audit_log_insert_only ON public.audit_log
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = actor_id);