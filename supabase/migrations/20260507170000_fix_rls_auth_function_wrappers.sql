-- =============================================================================
-- RLS performance hardening
-- - Wrap auth.uid()/auth.jwt()/current_setting() calls in SELECT inside policy
--   expressions to avoid auth_rls_initplan performance warnings.
-- - Remove legacy duplicate SELECT policies that can trigger multiple permissive
--   policy warnings.
-- =============================================================================

DO $$
DECLARE
  pol RECORD;
  old_qual TEXT;
  old_check TEXT;
  new_qual TEXT;
  new_check TEXT;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE
      (qual ~ 'auth\\.uid\\(\\)' OR qual ~ 'auth\\.jwt\\(\\)' OR qual ~ 'current_setting\\(')
      OR (with_check ~ 'auth\\.uid\\(\\)' OR with_check ~ 'auth\\.jwt\\(\\)' OR with_check ~ 'current_setting\\(')
  LOOP
    old_qual := COALESCE(pol.qual, '');
    old_check := COALESCE(pol.with_check, '');

    new_qual := replace(old_qual, '(SELECT auth.uid())', '__AUTH_UID__');
    new_qual := replace(new_qual, '(SELECT auth.jwt())', '__AUTH_JWT__');
    new_qual := replace(new_qual, '(SELECT current_setting(', '__CURRENT_SETTING__');

    new_check := replace(old_check, '(SELECT auth.uid())', '__AUTH_UID__');
    new_check := replace(new_check, '(SELECT auth.jwt())', '__AUTH_JWT__');
    new_check := replace(new_check, '(SELECT current_setting(', '__CURRENT_SETTING__');

    new_qual := replace(new_qual, 'auth.uid()', '(SELECT auth.uid())');
    new_qual := replace(new_qual, 'auth.jwt()', '(SELECT auth.jwt())');
    new_qual := replace(new_qual, 'current_setting(', '(SELECT current_setting(');

    new_check := replace(new_check, 'auth.uid()', '(SELECT auth.uid())');
    new_check := replace(new_check, 'auth.jwt()', '(SELECT auth.jwt())');
    new_check := replace(new_check, 'current_setting(', '(SELECT current_setting(');

    new_qual := replace(new_qual, '__AUTH_UID__', '(SELECT auth.uid())');
    new_qual := replace(new_qual, '__AUTH_JWT__', '(SELECT auth.jwt())');
    new_qual := replace(new_qual, '__CURRENT_SETTING__', '(SELECT current_setting(');

    IF new_qual <> old_qual AND pol.cmd IN ('SELECT', 'UPDATE', 'DELETE', 'ALL') THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        pol.policyname,
        pol.schemaname,
        pol.tablename,
        new_qual
      );
    END IF;

    IF new_check <> old_check AND pol.cmd IN ('INSERT', 'UPDATE', 'ALL') THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        pol.policyname,
        pol.schemaname,
        pol.tablename,
        new_check
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.integrations') IS NOT NULL THEN
    DROP POLICY IF EXISTS integrations_select_own ON public.integrations;
  END IF;

  IF to_regclass('public.financial_settlements') IS NOT NULL THEN
    DROP POLICY IF EXISTS financial_settlements_select_clinic ON public.financial_settlements;
  END IF;

  IF to_regclass('public.whatsapp_conversations') IS NOT NULL THEN
    DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON public.whatsapp_conversations;
  END IF;
END $$;
