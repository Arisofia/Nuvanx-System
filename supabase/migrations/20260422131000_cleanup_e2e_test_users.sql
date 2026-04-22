-- Remove automated E2E users from production-like environments.
-- Scope: users ending with @nuvanx.test and prefixed with e2e-

DO $$
DECLARE
  deleted_public_users integer := 0;
  deleted_auth_users integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    DELETE FROM public.users
    WHERE email ILIKE 'e2e-%@nuvanx.test';
    GET DIAGNOSTICS deleted_public_users = ROW_COUNT;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'auth'
      AND table_name = 'users'
  ) THEN
    DELETE FROM auth.users
    WHERE email ILIKE 'e2e-%@nuvanx.test';
    GET DIAGNOSTICS deleted_auth_users = ROW_COUNT;
  END IF;

  RAISE NOTICE 'Deleted % rows from public.users and % rows from auth.users', deleted_public_users, deleted_auth_users;
END $$;
