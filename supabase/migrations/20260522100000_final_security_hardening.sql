-- =============================================================================
-- Final Security Hardening (RLS & SECURITY DEFINER) - Actualizado 2026-05-31
-- =============================================================================

BEGIN;

-- 1. Enable RLS on core tables
DO $$
DECLARE
  t TEXT;
  core_tables TEXT[] := ARRAY[
    'leads', 'integrations', 'credentials', 'patients', 'doctors',
    'treatment_types', 'appointments', 'whatsapp_conversations',
    'doctoralia_patients', 'users'
  ];
BEGIN
  FOREACH t IN ARRAY core_tables LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- 2. Harden SECURITY DEFINER functions with search_path
DO $$
BEGIN
  IF to_regprocedure('public.current_user_id()') IS NOT NULL THEN
    ALTER FUNCTION public.current_user_id() SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.current_clinic_id()') IS NOT NULL THEN
    ALTER FUNCTION public.current_clinic_id() SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.get_campaign_roi(uuid,text,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.get_campaign_roi(uuid,text,text,text) SET search_path = public, pg_catalog;
  END IF;

  IF to_regprocedure('public.get_trazabilidad_funnel(uuid,date,date,date,date,date,date)') IS NOT NULL THEN
    ALTER FUNCTION public.get_trazabilidad_funnel(uuid,date,date,date,date,date,date) SET search_path = public, pg_catalog;
  END IF;
END $$;

-- 3. Set security_invoker = true on important views
DO $$
DECLARE
  v TEXT;
  view_list TEXT[] := ARRAY[
    'master_pacientes_trazabilidad',
    'vw_doctoralia_trazabilidad_360',
    'financial_patient_production_rollup',
    'vw_doctoralia_lead_traceability_unified',
    'vw_doctoralia_patient_ltv',
    'vw_campaign_performance_real',
    'vw_lead_traceability',
    'vw_produccion_intermediarios_kpis',
    'vw_produccion_intermediarios_by_agenda',
    'vw_produccion_intermediarios_by_proc'
  ];
BEGIN
  FOREACH v IN ARRAY view_list LOOP
    IF to_regclass(format('public.%I', v)) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
    END IF;
  END LOOP;
END $$;

-- 4. Basic RLS policy for users table
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'users' AND policyname = 'users_select_own'
    ) THEN
      CREATE POLICY users_select_own ON public.users
        FOR SELECT TO authenticated
        USING ((SELECT auth.uid()) = id);
    END IF;
  END IF;
END $$;

COMMIT;
