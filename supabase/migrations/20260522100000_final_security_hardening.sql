-- =============================================================================
-- Final Security Hardening (RLS & SECURITY DEFINER) - Actualizado 2026-05-31
-- =============================================================================
--
-- Esta migración realiza varias acciones de endurecimiento de seguridad:
--
-- 1. Habilita Row Level Security (RLS) en tablas core que aún no lo tenían.
-- 2. Endurece funciones SECURITY DEFINER con SET search_path seguro
--    (previene search_path hijacking).
-- 3. Configura security_invoker = true en vistas críticas para que respeten RLS
--    de las tablas subyacentes.
-- 4. Agrega una política básica de ownership en la tabla users.
--
-- Revisión 2026-05-31 (Revisión #4):
-- - Lista de vistas actualizada con las de Producción Intermediarios.
-- - Comentarios mejorados.
-- - Nota sobre alcance limitado de funciones endurecidas (ver consolidación posterior).
--
-- Funciones y vistas adicionales pueden haber sido endurecidas en migraciones
-- de consolidación posteriores (20260531000010).
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
--    This prevents functions from being vulnerable to search_path hijacking attacks.
--    We only harden the most critical ones here to avoid breaking functions that
--    legitimately need to access other schemas (e.g., extensions).
--    Additional functions were hardened later in 20260531000010.
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
--    This ensures that queries against these views will respect the RLS policies
--    of the underlying tables (instead of bypassing them with the view owner's privileges).
--    Includes key traceability, financial, doctoralia, campaign, and produccion_intermediarios views.
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
--    Simple ownership policy: authenticated users can only see their own record.
--
--    Limitation: This is intentionally minimal. More advanced policies
--    (e.g., clinic-scoped access, admin roles, etc.) may exist in later
--    consolidation migrations.
--
--    Note on updated_at: Several tables have an `updated_at` column.
--    Automatic maintenance via triggers is recommended but not implemented
--    in this migration (handled elsewhere or manually in application code).
--    Consider adding a generic updated_at trigger in a future cleanup migration
--    if data consistency becomes an issue.
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
