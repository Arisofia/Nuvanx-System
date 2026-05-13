-- =============================================================================
-- RLS performance optimization (auth_rls_initplan)
-- Wrap auth functions and clinic lookups in subqueries to enable InitPlan
-- optimization and avoid per-row re-evaluation.
-- =============================================================================

-- 1. Update existing policies with the optimized (SELECT ...) pattern.

DO $$
DECLARE
  t TEXT;
  core_tables TEXT[] := ARRAY['leads', 'integrations', 'credentials'];
BEGIN
  FOREACH t IN ARRAY core_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = t
           AND c.column_name = 'clinic_id'
       ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_select_clinic ON public.%I'
        ' FOR SELECT TO authenticated'
        ' USING ('
        '   (SELECT auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'''
        '   AND clinic_id = (SELECT public.current_clinic_id())'
        ' )',
        t, t
      );
    ELSE
      RAISE NOTICE 'Skipping optimized %_select_clinic policy: table or clinic_id column does not exist', t;
    END IF;
  END LOOP;
END $$;

-- api_call_log
DO $$
BEGIN
  IF to_regclass('public.api_call_log') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = 'api_call_log'
         AND c.column_name = 'user_id'
     ) THEN
    DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
    CREATE POLICY api_call_log_select_own ON public.api_call_log
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND (SELECT auth.uid()) = user_id
      );
  ELSE
    RAISE NOTICE 'Skipping optimized api_call_log_select_own policy: table or user_id column does not exist';
  END IF;
END $$;

-- Loop for standard clinic-scoped tables
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'patients', 'doctors', 'treatment_types',
    'appointments', 'financial_settlements', 'whatsapp_conversations',
    'doctoralia_patients'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name = t
           AND c.column_name = 'clinic_id'
       ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_select_clinic ON public.%I'
        ' FOR SELECT TO authenticated'
        ' USING ('
        '   (SELECT auth.jwt() ->> ''is_anonymous'') IS DISTINCT FROM ''true'''
        '   AND clinic_id = (SELECT public.current_clinic_id())'
        ' )',
        t, t
      );
    ELSE
      RAISE NOTICE 'Skipping optimized %_select_clinic policy: table or clinic_id column does not exist', t;
    END IF;
  END LOOP;
END $$;

COMMENT ON SCHEMA public IS 'Optimized RLS policies using subquery wrappers for auth functions to resolve auth_rls_initplan warnings.';
