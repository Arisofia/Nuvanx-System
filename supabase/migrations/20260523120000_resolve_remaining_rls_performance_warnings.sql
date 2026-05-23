-- Resolve remaining Supabase advisor performance warnings:
-- - auth_rls_initplan on selected policies
-- - multiple_permissive_policies on selected tables

BEGIN;

DO $$
BEGIN
  -- clinics: keep one SELECT policy for authenticated and wrap auth calls in SELECT.
  IF to_regclass('public.clinics') IS NOT NULL THEN
    DROP POLICY IF EXISTS clinics_select_own ON public.clinics;
    DROP POLICY IF EXISTS clinics_select ON public.clinics;

    CREATE POLICY clinics_select ON public.clinics
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.uid()) IS NOT NULL
        AND id = (SELECT public.current_clinic_id())
      );
  END IF;

  -- leads: keep one authenticated SELECT policy + service-only policy, both with initplan wrappers.
  IF to_regclass('public.leads') IS NOT NULL THEN
    DROP POLICY IF EXISTS leads_select_authenticated_or_clinic ON public.leads;
    DROP POLICY IF EXISTS leads_select ON public.leads;

    CREATE POLICY leads_select ON public.leads
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.uid()) IS NOT NULL
        AND clinic_id = (SELECT public.current_clinic_id())
      );

    DROP POLICY IF EXISTS leads_service_only ON public.leads;
    CREATE POLICY leads_service_only ON public.leads
      FOR ALL TO service_role
      USING ((SELECT auth.role()) = 'service_role')
      WITH CHECK ((SELECT auth.role()) = 'service_role');
  END IF;

  -- whatsapp_conversations: keep one authenticated SELECT policy.
  IF to_regclass('public.whatsapp_conversations') IS NOT NULL THEN
    DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON public.whatsapp_conversations;
    DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;

    CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.uid()) IS NOT NULL
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;

  -- financial_settlements: rewrite service policy with SELECT wrapper.
  IF to_regclass('public.financial_settlements') IS NOT NULL THEN
    DROP POLICY IF EXISTS financial_settlements_service_role_only ON public.financial_settlements;
    CREATE POLICY financial_settlements_service_role_only ON public.financial_settlements
      FOR ALL TO service_role
      USING ((SELECT auth.role()) = 'service_role')
      WITH CHECK ((SELECT auth.role()) = 'service_role');
  END IF;

  -- agent_outputs: merge duplicate authenticated INSERT policies into one and wrap auth calls.
  IF to_regclass('public.agent_outputs') IS NOT NULL THEN
    DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
    DROP POLICY IF EXISTS agent_outputs_insert_service ON public.agent_outputs;

    CREATE POLICY agent_outputs_insert ON public.agent_outputs
      FOR INSERT TO authenticated
      WITH CHECK (
        (
          COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
          AND user_id = (SELECT auth.uid())
        )
        OR (SELECT auth.role()) = 'service_role'
      );

    DROP POLICY IF EXISTS agent_outputs_read_service ON public.agent_outputs;
    CREATE POLICY agent_outputs_read_service ON public.agent_outputs
      FOR SELECT TO service_role
      USING ((SELECT auth.role()) = 'service_role');
  END IF;
END $$;

COMMIT;
