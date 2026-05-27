-- 20260528000000_final_cron_anon_rls_hardening.sql
--
-- Final, definitive hardening for pg_cron tables to satisfy
-- auth_allow_anonymous_sign_ins advisor warnings.
--
-- Goal: Ensure only service_role can access cron.job and cron.job_run_details.
-- Previous attempts left behind policies with old names that the advisor still detects.

DO $$
BEGIN
  -- Harden cron.job
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      -- Drop all known previous policy names that may still exist
      EXECUTE 'DROP POLICY IF EXISTS cron_job_policy ON cron.job';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_select ON cron.job';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_insert ON cron.job';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_update ON cron.job';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_delete ON cron.job';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_all ON cron.job';

      -- Create a single, restrictive policy for service_role only
      EXECUTE 'CREATE POLICY cron_job_service_role_only ON cron.job
               FOR ALL TO service_role
               USING (true)
               WITH CHECK (true)';

      RAISE NOTICE 'cron.job: Applied service_role-only policy';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cron.job: Insufficient privilege to manage policies. Manual intervention may be required.';
    END;
  END IF;

  -- Harden cron.job_run_details
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    BEGIN
      -- Drop all known previous policy names
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_select ON cron.job_run_details';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_insert ON cron.job_run_details';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_update ON cron.job_run_details';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_delete ON cron.job_run_details';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_all ON cron.job_run_details';

      -- Create a single, restrictive policy for service_role only
      EXECUTE 'CREATE POLICY cron_job_run_details_service_role_only ON cron.job_run_details
               FOR ALL TO service_role
               USING (true)
               WITH CHECK (true)';

      RAISE NOTICE 'cron.job_run_details: Applied service_role-only policy';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'cron.job_run_details: Insufficient privilege to manage policies. Manual intervention may be required.';
    END;
  END IF;
END $$;

-- Final comment for the advisor
COMMENT ON TABLE cron.job IS 'RLS hardened - only service_role should have access (see migration 20260528000000)';
COMMENT ON TABLE cron.job_run_details IS 'RLS hardened - only service_role should have access (see migration 20260528000000)';