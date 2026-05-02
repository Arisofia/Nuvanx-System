-- =============================================================================
-- Remove anon role from pg_cron RLS policies
--
-- The Supabase advisor flags cron.job and cron.job_run_details because
-- pg_cron creates its default policies with both authenticated AND anon roles.
-- ALTER POLICY is not sufficient because pg_cron may recreate the policy on
-- extension reload. We drop and recreate with the original USING expression
-- intact, but with anon removed from the role list.
--
-- NOTE: auth_leaked_password_protection cannot be fixed via SQL.
--       Enable it at: Supabase Dashboard → Authentication → Providers →
--       Password → "Prevent use of leaked passwords"
-- =============================================================================

DO $$
DECLARE
  pol        RECORD;
  anon_oid   OID;
  r          OID;
  role_name  TEXT;
  other_roles TEXT[];
  roles_str  TEXT;
BEGIN
  SELECT oid INTO anon_oid FROM pg_roles WHERE rolname = 'anon';

  FOR pol IN
    SELECT
      p.polname,
      p.polrelid,
      p.polroles,
      n.nspname  AS schemaname,
      c.relname  AS tablename,
      pg_get_expr(p.polqual, p.polrelid) AS qual
    FROM pg_policy p
    JOIN pg_class     c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'cron'
      AND c.relname IN ('job', 'job_run_details')
      AND (
        -- policy applies to PUBLIC (empty array = all roles)
        array_length(p.polroles, 1) IS NULL
        OR anon_oid = ANY(p.polroles)
      )
  LOOP
    -- Build the new role list: keep everything except anon
    -- If polroles is empty/null it means PUBLIC → default to authenticated
    IF pol.polroles IS NULL OR array_length(pol.polroles, 1) IS NULL THEN
      roles_str := 'authenticated';
    ELSE
      other_roles := ARRAY[]::TEXT[];
      FOREACH r IN ARRAY pol.polroles LOOP
        SELECT rolname INTO role_name FROM pg_roles WHERE oid = r;
        IF role_name IS DISTINCT FROM 'anon' THEN
          other_roles := other_roles || quote_ident(role_name);
        END IF;
      END LOOP;
      IF array_length(other_roles, 1) IS NULL THEN
        -- anon was the only role — replace with authenticated
        roles_str := 'authenticated';
      ELSE
        roles_str := array_to_string(other_roles, ', ');
      END IF;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      pol.polname, pol.schemaname, pol.tablename);

    IF pol.qual IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I TO %s USING (%s)',
        pol.polname, pol.schemaname, pol.tablename, roles_str, pol.qual
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I TO %s',
        pol.polname, pol.schemaname, pol.tablename, roles_str
      );
    END IF;
  END LOOP;
END $$;
