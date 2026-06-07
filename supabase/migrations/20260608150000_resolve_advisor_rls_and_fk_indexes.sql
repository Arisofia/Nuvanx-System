-- =============================================================================
-- Resolve Supabase Advisor performance warnings: unindexed foreign keys,
-- auth_rls_initplan, and multiple permissive policies on market_intelligence.
--
-- This migration is intentionally order-safe. Every table/column/policy operation
-- is guarded so fresh or partially-replayed environments skip missing objects
-- instead of failing deployment.
-- =============================================================================

DO $$
DECLARE
  target RECORD;
  index_name TEXT;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('agent_outputs', 'clinic_id'),
      ('agent_runs', 'execution_id'),
      ('agent_runs', 'playbook_id'),
      ('appointments', 'clinic_id'),
      ('appointments', 'doctor_id'),
      ('appointments', 'patient_id'),
      ('appointments', 'treatment_type_id'),
      ('credentials', 'clinic_id'),
      ('doctors', 'clinic_id'),
      ('financial_settlements', 'lead_id'),
      ('leads', 'assigned_to'),
      ('leads', 'doctor_id'),
      ('leads', 'merged_into_lead_id'),
      ('leads', 'treatment_type_id'),
      ('meta_ig_account_daily', 'clinic_id'),
      ('meta_ig_media_performance', 'clinic_id'),
      ('meta_organic_daily', 'clinic_id'),
      ('meta_post_performance', 'clinic_id'),
      ('playbook_executions', 'agent_output_id'),
      ('playbooks', 'owner_user_id'),
      ('treatment_types', 'clinic_id'),
      ('users', 'clinic_id'),
      ('whatsapp_conversations', 'clinic_id'),
      ('whatsapp_conversations', 'lead_id')
    ) AS t(table_name, column_name)
  LOOP
    IF to_regclass(format('public.%I', target.table_name)) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = target.table_name
          AND column_name = target.column_name
      ) THEN
      index_name := left(format('idx_%s_%s_fk', target.table_name, target.column_name), 63);
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
        index_name,
        target.table_name,
        target.column_name
      );
    ELSE
      RAISE NOTICE 'Skipping FK covering index on %.%: table or column is missing', target.table_name, target.column_name;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.market_intelligence') IS NOT NULL THEN
    DROP POLICY IF EXISTS authenticated_read ON public.market_intelligence;
    CREATE POLICY authenticated_read ON public.market_intelligence
      FOR SELECT
      TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::BOOLEAN, FALSE) = FALSE
      );

    DROP POLICY IF EXISTS service_role_full ON public.market_intelligence;
    CREATE POLICY service_role_full ON public.market_intelligence
      FOR ALL
      TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  ELSE
    RAISE NOTICE 'Skipping market_intelligence policy hardening: table does not exist';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.clinics') IS NOT NULL THEN
    DROP POLICY IF EXISTS clinics_select ON public.clinics;
    CREATE POLICY clinics_select ON public.clinics
      FOR SELECT
      TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::BOOLEAN, FALSE) = FALSE
        AND id = (SELECT public.current_clinic_id())
      );
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.agent_outputs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agent_outputs' AND column_name = 'user_id'
    ) THEN
      DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs;
      DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
      CREATE POLICY agent_outputs_insert ON public.agent_outputs
        FOR INSERT
        TO authenticated
        WITH CHECK (
          COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::BOOLEAN, FALSE) = FALSE
          AND user_id = (SELECT auth.uid())
        );
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'agent_outputs' AND column_name = 'clinic_id'
    ) THEN
      DROP POLICY IF EXISTS agent_outputs_select_clinic ON public.agent_outputs;
      CREATE POLICY agent_outputs_select_clinic ON public.agent_outputs
        FOR SELECT
        TO authenticated
        USING (
          COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::BOOLEAN, FALSE) = FALSE
          AND clinic_id = (SELECT public.current_clinic_id())
        );
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.api_call_log') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_call_log' AND column_name = 'user_id'
    ) THEN
    DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
    CREATE POLICY api_call_log_select_own ON public.api_call_log
      FOR SELECT
      TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::BOOLEAN, FALSE) = FALSE
        AND user_id = (SELECT auth.uid())
      );
  END IF;
END $$;

DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('meta_daily_insights', 'meta_daily_insights_select'),
      ('meta_organic_daily', 'meta_organic_daily_select'),
      ('meta_post_performance', 'meta_post_performance_select'),
      ('meta_ig_account_daily', 'meta_ig_account_daily_select'),
      ('meta_ig_media_performance', 'meta_ig_media_performance_select'),
      ('produccion_intermediarios', 'produccion_intermediarios_select')
    ) AS t(table_name, policy_name)
  LOOP
    IF to_regclass(format('public.%I', target.table_name)) IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = target.table_name
          AND column_name = 'clinic_id'
      ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target.policy_name || '_clinic', target.table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target.policy_name || '_own', target.table_name);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target.policy_name, target.table_name);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (COALESCE(((SELECT auth.jwt()) ->> ''is_anonymous'')::BOOLEAN, FALSE) = FALSE AND clinic_id = (SELECT public.current_clinic_id()))',
        target.policy_name,
        target.table_name
      );
    ELSE
      RAISE NOTICE 'Skipping % policy rewrite: table or clinic_id column is missing', target.policy_name;
    END IF;
  END LOOP;
END $$;
