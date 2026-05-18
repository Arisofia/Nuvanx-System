-- =============================================================================
-- Remove anon role from pg_cron RLS policies
--
-- The Supabase advisor flags cron.job and cron.job_run_details because
-- pg_cron creates its default policies with both authenticated AND anon roles.
-- ALTER POLICY is not sufficient because pg_cron may recreate the policy on
-- extension reload. We drop and recreate each matching policy while
-- preserving its command, permissive/restrictive mode, USING expression, and
-- WITH CHECK expression, but with anon removed from the role list.
--
-- NOTE: auth_leaked_password_protection cannot be fixed via SQL.
--       Enable it at: Supabase Dashboard → Authentication → Providers →
--       Password → "Prevent use of leaked passwords"
-- =============================================================================

DO $$
DECLARE
  pol          RECORD;
  anon_oid     OID;
  r            OID;
  role_name    TEXT;
  other_roles  TEXT[];
  roles_str    TEXT;
  cmd_str      TEXT;
  policy_kind  TEXT;
  using_clause TEXT := '';
  check_clause TEXT := '';
BEGIN
  SELECT oid INTO anon_oid FROM pg_roles WHERE rolname = 'anon';

  FOR pol IN
    SELECT
      p.polname,
      p.polrelid,
      p.polroles,
      p.polcmd,
      p.polpermissive,
      pg_get_expr(p.polqual, p.polrelid)      AS qual,
      pg_get_expr(p.polwithcheck, p.polrelid) AS withcheck,
      n.nspname AS schemaname,
      c.relname AS tablename
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'cron'
      AND c.relname IN ('job', 'job_run_details')
      AND (
        -- policy applies to PUBLIC (0::oid or empty array = all roles)
        array_length(p.polroles, 1) IS NULL
        OR 0::OID = ANY(p.polroles)
        OR anon_oid = ANY(p.polroles)
      )
  LOOP
    -- Build the new role list: keep everything except anon.
    -- If polroles is empty/null or contains PUBLIC, default to authenticated.
    IF pol.polroles IS NULL
       OR array_length(pol.polroles, 1) IS NULL
       OR 0::OID = ANY(pol.polroles) THEN
      roles_str := quote_ident('authenticated');
    ELSE
      other_roles := ARRAY[]::TEXT[];
      FOREACH r IN ARRAY pol.polroles LOOP
        SELECT rolname INTO role_name FROM pg_roles WHERE oid = r;
        IF role_name IS NOT NULL AND role_name IS DISTINCT FROM 'anon' THEN
          other_roles := other_roles || quote_ident(role_name);
        END IF;
      END LOOP;

      IF array_length(other_roles, 1) IS NULL THEN
        -- anon was the only role -- replace with authenticated.
        roles_str := quote_ident('authenticated');
      ELSE
        roles_str := array_to_string(other_roles, ', ');
      END IF;
    END IF;

    cmd_str := CASE pol.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      ELSE 'ALL'
    END;

    policy_kind := CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END;

    -- Preserve pg_policy semantics while only emitting clauses valid for the
    -- stored command. SELECT/DELETE cannot use WITH CHECK; INSERT cannot use USING.
    IF pol.qual IS NOT NULL AND pol.polcmd IN ('r', 'w', 'd', '*') THEN
      using_clause := format(' USING (%s)', pol.qual);
    ELSE
      using_clause := '';
    END IF;

    IF pol.withcheck IS NOT NULL AND pol.polcmd IN ('a', 'w', '*') THEN
      check_clause := format(' WITH CHECK (%s)', pol.withcheck);
    ELSE
      check_clause := '';
    END IF;

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.polname, pol.schemaname, pol.tablename
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      pol.polname,
      pol.schemaname,
      pol.tablename,
      policy_kind,
      cmd_str,
      roles_str,
      using_clause,
      check_clause
    );
  END LOOP;
END $$;
