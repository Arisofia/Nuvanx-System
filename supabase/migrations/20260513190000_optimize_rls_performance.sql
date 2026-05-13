-- =============================================================================
-- RLS performance optimization (auth_rls_initplan)
-- Wrap auth functions and clinic lookups in subqueries to enable InitPlan
-- optimization and avoid per-row re-evaluation.
-- =============================================================================

-- 1. Helper function for consistent UID subquery (optional but good for clarity)
-- 2. Update existing policies with the optimized (SELECT ...) pattern.

-- leads
DROP POLICY IF EXISTS leads_select_clinic ON public.leads;
CREATE POLICY leads_select_clinic ON public.leads
  FOR SELECT TO authenticated
  USING (
    ((SELECT auth.jwt()) ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- integrations
DROP POLICY IF EXISTS integrations_select_clinic ON public.integrations;
CREATE POLICY integrations_select_clinic ON public.integrations
  FOR SELECT TO authenticated
  USING (
    ((SELECT auth.jwt()) ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- credentials
DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
CREATE POLICY credentials_select_clinic ON public.credentials
  FOR SELECT TO authenticated
  USING (
    ((SELECT auth.jwt()) ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- api_call_log
DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
CREATE POLICY api_call_log_select_own ON public.api_call_log
  FOR SELECT TO authenticated
  USING (
    ((SELECT auth.jwt()) ->> 'is_anonymous') IS DISTINCT FROM 'true'
    AND (SELECT auth.uid()) = user_id
  );

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
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_select_clinic ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY %I_select_clinic ON public.%I'
        ' FOR SELECT TO authenticated'
        ' USING (((SELECT auth.jwt()) ->> ''is_anonymous'') IS DISTINCT FROM ''true'''
        '        AND clinic_id = (SELECT public.current_clinic_id()))',
        t, t
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON SCHEMA public IS 'Optimized RLS policies using subquery wrappers for auth functions to resolve auth_rls_initplan warnings.';
