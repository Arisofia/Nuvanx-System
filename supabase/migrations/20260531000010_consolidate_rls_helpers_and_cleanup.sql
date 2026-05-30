-- =============================================================================
-- Consolidación final de helpers RLS + limpieza de código obsoleto
-- Fecha: 2026-05-31
-- 
-- NOTA: Timestamp intencionalmente 00010 para ejecutarse DESPUÉS de
--       20260531000000_mark_final_rls_hardening_as_obsolete.sql
--       (evita colisión de nombres de migración).
--
-- Objetivo:
--   - Mejorar current_clinic_id() (más robusto y sin excepciones innecesarias)
--   - Consolidar current_user_id()
--   - Eliminar funciones muertas (is_service_role)
--   - Asegurar search_path correcto en helpers
--   - Documentar que migraciones anteriores de RLS fueron consolidadas
-- =============================================================================

BEGIN;

-- 1. Mejorar current_clinic_id() (versión más limpia y robusta)
CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_claim_clinic uuid;
  v_user_clinic uuid;
BEGIN
  v_user_id := (SELECT auth.uid());
  
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Intentar obtener clinic_id del JWT (más rápido)
  BEGIN
    v_claim_clinic := ((SELECT auth.jwt()) ->> 'clinic_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_claim_clinic := NULL;
  END;

  IF v_claim_clinic IS NOT NULL THEN
    RETURN v_claim_clinic;
  END IF;

  -- Fallback a tabla users (solo si existe)
  IF to_regclass('public.users') IS NOT NULL THEN
    SELECT clinic_id INTO v_user_clinic 
    FROM public.users 
    WHERE id = v_user_id 
    LIMIT 1;
    
    RETURN v_user_clinic;
  END IF;

  RETURN NULL;
END;
$$;

-- 2. Mejorar current_user_id()
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT (SELECT auth.uid());
$$;

-- 3. Eliminar función muerta is_service_role() (solo existía en migración obsoleta)
DROP FUNCTION IF EXISTS public.is_service_role();

-- 4. Comentario de consolidación
COMMENT ON FUNCTION public.current_clinic_id() IS 
  'Helper consolidado (20260531). Usar siempre como (SELECT public.current_clinic_id()).';

COMMENT ON FUNCTION public.current_user_id() IS 
  'Helper consolidado (20260531).';

-- 5. Nota para el equipo
DO $$
BEGIN
  RAISE NOTICE 'Consolidación RLS completada.';
  RAISE NOTICE 'Se recomienda ejecutar supabase db lint después de aplicar esta migración.';
END $$;

COMMIT;
