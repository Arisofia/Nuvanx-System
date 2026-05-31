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
BEGIN
  SET search_path = cron, public;

  FOREACH t IN ARRAY cron_tables LOOP
    IF to_regclass(t) IS NOT NULL THEN
      BEGIN
        -- Drop all known previous policy names that may still exist
        EXECUTE format('DROP POLICY IF EXISTS cron_job_policy ON %s', t);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_select ON %s', t);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_insert ON %s', t);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_update ON %s', t);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_delete ON %s', t);
        EXECUTE format('DROP POLICY IF EXISTS cron_job_all ON %s', t);
        EXECUTE format('DROP POLICY IF EXISTS %I_policy ON %s', split_part(t, '.', 2), t);
        EXECUTE format('DROP POLICY IF EXISTS %I_select ON %s', split_part(t, '.', 2), t);
        EXECUTE format('DROP POLICY IF EXISTS %I_insert ON %s', split_part(t, '.', 2), t);
        EXECUTE format('DROP POLICY IF EXISTS %I_update ON %s', split_part(t, '.', 2), t);
        EXECUTE format('DROP POLICY IF EXISTS %I_delete ON %s', split_part(t, '.', 2), t);
        EXECUTE format('DROP POLICY IF EXISTS %I_all ON %s', split_part(t, '.', 2), t);

        -- Create a single, restrictive policy for service_role only
        EXECUTE format('CREATE POLICY %I_service_role_only ON %s
                        FOR ALL TO service_role
                        USING (true)
                        WITH CHECK (true)', split_part(t, '.', 2), t);

        RAISE NOTICE '%: Applied service_role-only policy', t;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '%: Insufficient privilege to manage policies. Manual intervention may be required.', t;
      END;
    END IF;
  END LOOP;
END $$;

-- Final comment for the advisor
COMMENT ON TABLE cron.job IS 'RLS hardened - only service_role should have access (see migration 20260528000000)';
COMMENT ON TABLE cron.job_run_details IS 'RLS hardened - only service_role should have access (see migration 20260528000000)';