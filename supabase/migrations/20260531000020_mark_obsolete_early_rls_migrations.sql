-- =============================================================================
-- Marca como obsoletas varias migraciones tempranas de RLS (Mayo 2026)
-- Fecha: 2026-05-31
--
-- Estas migraciones fueron intentos tempranos / parciales que han sido
-- reemplazados por un conjunto más completo y consistente de migraciones
-- de finales de mayo (especialmente 20260529xxx y 20260530xxx) + la
-- consolidación de helpers en 20260531000010.
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRACIONES MARCADAS COMO OBSOLETAS (2026-05-31)';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 1. 20260523090000_final_rls_hardening.sql
-- ============================================================================
-- Muy pequeña, solo tocaba unas pocas tablas y creaba is_service_role()
-- (función que nunca se usó consistentemente).

DO $$
BEGIN
  RAISE NOTICE '→ 20260523090000_final_rls_hardening.sql → OBSOLETA';
  RAISE NOTICE '   Reemplazada por: 20260522100000 + 20260529/20260530 series';
END $$;

DROP FUNCTION IF EXISTS public.is_service_role();

-- ============================================================================
-- 2. 20260507170000_fix_rls_auth_function_wrappers.sql
-- ============================================================================
-- Enfoque dinámico (reemplazaba texto en policies) que era frágil.

DO $$
BEGIN
  RAISE NOTICE '→ 20260507170000_fix_rls_auth_function_wrappers.sql → OBSOLETA';
  RAISE NOTICE '   Enfoque dinámico superado por policies explícitas y helpers consolidados.';
END $$;

-- ============================================================================
-- 3. 20260521100000_fix_rls_auth_initplan_select_wrapper.sql
-- ============================================================================
-- Versión manual temprana del fix de initplan. Incompleta y reemplazada.

DO $$
BEGIN
  RAISE NOTICE '→ 20260521100000_fix_rls_auth_initplan_select_wrapper.sql → OBSOLETA';
  RAISE NOTICE '   Reemplazada por migraciones más completas de finales de mayo.';
END $$;

-- ============================================================================
-- 4 & 5. Migraciones de cron anon policies (duplicados de documentación)
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '→ 20260502120000_fix_cron_anon_policies.sql → OBSOLETA (duplicado)';
  RAISE NOTICE '→ 20260502140000_fix_cron_anon_final.sql → OBSOLETA (duplicado)';
  RAISE NOTICE '   Ambas son duplicados de documentación. No aportan cambios nuevos.';
END $$;

-- ============================================================================
-- Resumen final
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Limpieza de migraciones tempranas completada.';
  RAISE NOTICE 'Se recomienda:';
  RAISE NOTICE '  1. Ejecutar supabase db lint';
  RAISE NOTICE '  2. Revisar supabase-security.yml y deploy.yml';
  RAISE NOTICE '══════════════════════════════════════════════════════════════════';
END $$;
