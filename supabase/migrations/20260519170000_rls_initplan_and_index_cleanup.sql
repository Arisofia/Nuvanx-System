-- =============================================================================
-- RLS initplan optimization + duplicate index cleanup
-- - Wrap auth.uid()/auth.jwt()/current_setting('request.jwt.claims', true) in SELECT
--   for policy expressions so PostgreSQL can initplan once per statement.
-- - Drop redundant integrations indexes while preserving one canonical unique index.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  rec RECORD;
  old_qual text;
  old_check text;
  new_qual text;
  new_check text;
BEGIN
  FOR rec IN
    SELECT
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual ILIKE '%auth.uid()%'
        OR qual ILIKE '%auth.jwt()%'
        OR qual ILIKE '%current_setting(''request.jwt.claims'', true)%'
        OR with_check ILIKE '%auth.uid()%'
        OR with_check ILIKE '%auth.jwt()%'
        OR with_check ILIKE '%current_setting(''request.jwt.claims'', true)%'
      )
  LOOP
    old_qual := rec.qual;
    old_check := rec.with_check;
    new_qual := old_qual;
    new_check := old_check;

    IF new_qual IS NOT NULL THEN
      new_qual := replace(new_qual, '(SELECT auth.uid())', '__AUTH_UID__');
      new_qual := replace(new_qual, '(SELECT auth.jwt())', '__AUTH_JWT__');
      new_qual := replace(new_qual, '(SELECT current_setting(''request.jwt.claims'', true))', '__JWT_CLAIMS__');

      new_qual := replace(new_qual, 'auth.uid()', '(SELECT auth.uid())');
      new_qual := replace(new_qual, 'auth.jwt()', '(SELECT auth.jwt())');
      new_qual := replace(new_qual, 'current_setting(''request.jwt.claims'', true)', '(SELECT current_setting(''request.jwt.claims'', true))');

      new_qual := replace(new_qual, '__AUTH_UID__', '(SELECT auth.uid())');
      new_qual := replace(new_qual, '__AUTH_JWT__', '(SELECT auth.jwt())');
      new_qual := replace(new_qual, '__JWT_CLAIMS__', '(SELECT current_setting(''request.jwt.claims'', true))');
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, '(SELECT auth.uid())', '__AUTH_UID__');
      new_check := replace(new_check, '(SELECT auth.jwt())', '__AUTH_JWT__');
      new_check := replace(new_check, '(SELECT current_setting(''request.jwt.claims'', true))', '__JWT_CLAIMS__');

      new_check := replace(new_check, 'auth.uid()', '(SELECT auth.uid())');
      new_check := replace(new_check, 'auth.jwt()', '(SELECT auth.jwt())');
      new_check := replace(new_check, 'current_setting(''request.jwt.claims'', true)', '(SELECT current_setting(''request.jwt.claims'', true))');

      new_check := replace(new_check, '__AUTH_UID__', '(SELECT auth.uid())');
      new_check := replace(new_check, '__AUTH_JWT__', '(SELECT auth.jwt())');
      new_check := replace(new_check, '__JWT_CLAIMS__', '(SELECT current_setting(''request.jwt.claims'', true))');
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', rec.policyname, rec.schemaname, rec.tablename);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s %s %s',
      rec.policyname,
      rec.schemaname,
      rec.tablename,
      rec.permissive,
      rec.cmd,
      array_to_string(rec.roles, ', '),
      CASE WHEN new_qual IS NOT NULL THEN format('USING (%s)', new_qual) ELSE '' END,
      CASE WHEN new_check IS NOT NULL THEN format('WITH CHECK (%s)', new_check) ELSE '' END
    );
  END LOOP;
END $$;

-- Keep one canonical unique index for (user_id, service) on integrations.
DO $$
BEGIN
  IF to_regclass('public.integrations') IS NOT NULL THEN
    -- Preserve the canonical unique index. Create if missing.
    IF to_regclass('public.integrations_user_id_service_unique_idx') IS NULL THEN
      EXECUTE 'CREATE UNIQUE INDEX integrations_user_id_service_unique_idx ON public.integrations(user_id, service)';
    END IF;

    -- Drop known redundant variants.
    IF to_regclass('public.integrations_user_id_service_key') IS NOT NULL THEN
      EXECUTE 'DROP INDEX public.integrations_user_id_service_key';
    END IF;

    IF to_regclass('public.integrations_user_service_unique_idx') IS NOT NULL THEN
      EXECUTE 'DROP INDEX public.integrations_user_service_unique_idx';
    END IF;
  END IF;
END $$;

COMMIT;
