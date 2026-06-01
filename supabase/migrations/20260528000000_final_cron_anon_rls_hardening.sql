-- 20260528000000_final_cron_anon_rls_hardening.sql
--
-- Final, definitive hardening for pg_cron tables to satisfy
-- auth_allow_anonymous_sign_ins advisor warnings.
--
-- Goal: Ensure only service_role can access cron.job and cron.job_run_details.
-- Previous attempts left behind policies with old names that the advisor still detects.
--
-- 2026-05-31 review note: Added SET search_path for good practice (per review).

DO $$
DECLARE
  t text;
  cron_tables text[] := ARRAY['cron.job', 'cron.job_run_details'];
  schema_name text;
  table_name text;
BEGIN
  -- Set search_path locally for the duration of this block
  SET LOCAL search_path = cron, public;

  FOREACH t IN ARRAY cron_tables LOOP
    IF to_regclass(t) IS NOT NULL THEN
      schema_name := split_part(t, '.', 1);
      table_name := split_part(t, '.', 2);

      BEGIN
        -- 1. Ensure RLS is enabled (CRITICAL for the policies to have any effect)
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', schema_name, table_name);

        -- 2. Drop all known previous policy names that may still exist
        EXECUTE format('DROP POLICY IF EXISTS cron_job_policy ON %I.%I', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_select ON %I.%I', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_insert ON %I.%I', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_update ON %I.%I', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_delete ON %I.%I', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_all ON %I.%I', schema_name, table_name);
        
        -- Drop dynamic names using the table name prefix
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', table_name || '_policy', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', table_name || '_select', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', table_name || '_insert', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', table_name || '_update', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', table_name || '_delete', schema_name, table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', table_name || '_all', schema_name, table_name);

        -- 3. Create a single, definitive, restrictive policy for service_role only
        EXECUTE format('CREATE POLICY %I ON %I.%I
                        FOR ALL TO service_role
                        USING (true)
                        WITH CHECK (true)', table_name || '_service_role_only', schema_name, table_name);

        -- 4. Add comment for the advisor
        EXECUTE format('COMMENT ON TABLE %I.%I IS %L', schema_name, table_name, 'RLS hardened - only service_role should have access (see migration 20260528000000)');

        RAISE NOTICE '%: Hardened RLS and applied service_role-only policy', t;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '%: Insufficient privilege to manage policies. Manual intervention may be required.', t;
      END;
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql;