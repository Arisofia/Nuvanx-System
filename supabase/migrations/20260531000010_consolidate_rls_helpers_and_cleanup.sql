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
--   - Hardcodear normalize_phone() con search_path seguro (revisión 2026-05-31)
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

-- 3. Hardening de normalize_phone() (revisión de código 2026-05-31)
-- Corrige SET search_path = '' (demasiado agresivo) → public, pg_catalog
-- Simplifica ligeramente la lógica de prefijos españoles
CREATE OR REPLACE FUNCTION public.normalize_phone(raw_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_phone IS NULL OR btrim(raw_phone) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(raw_phone, '[^0-9]', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  -- Quitar prefijos españoles
  IF cleaned LIKE '0034%' THEN
    cleaned := substring(cleaned FROM 5);
  ELSIF cleaned LIKE '34%' AND length(cleaned) > 9 THEN
    cleaned := substring(cleaned FROM 3);
  END IF;

  cleaned := regexp_replace(cleaned, '[^0-9]', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone(TEXT) IS
  'Normalizes Spanish phones for matching: strips non-digits and Spanish prefixes (0034, 34). Returns local digits only. Hardened 2026-05-31 (search_path + simplification).';

-- 3.5 Hardening de run_doctoralia_name_match() (revisión 2026-05-31)
-- Corrige SET search_path = '' (demasiado agresivo) → public, pg_catalog
CREATE OR REPLACE FUNCTION public.run_doctoralia_name_match()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  patient_row RECORD;
  lead_row    RECORD;
  sim         NUMERIC;
  ph_match    BOOLEAN;
  best_lid    UUID;
  best_score  NUMERIC := 0;
BEGIN
  FOR patient_row IN SELECT * FROM public.doctoralia_patients LOOP
    best_lid   := NULL;
    best_score := 0;
    FOR lead_row IN
      SELECT ld.id, ld.name, ld.phone
      FROM public.leads ld
      JOIN public.users u ON u.id = ld.user_id
      WHERE u.clinic_id = patient_row.clinic_id
    LOOP
      sim      := extensions.similarity(patient_row.name_norm, lower(extensions.unaccent(COALESCE(lead_row.name, ''))));
      ph_match := patient_row.phone_primary IS NOT NULL
                  AND lead_row.phone IS NOT NULL
                  AND patient_row.phone_primary = regexp_replace(lead_row.phone, '\D', '', 'g');
      IF sim > best_score OR (sim = best_score AND ph_match) THEN
        best_score := sim;
        best_lid   := lead_row.id;
      END IF;
    END LOOP;
    IF best_lid IS NOT NULL AND best_score >= 0.85 THEN
      UPDATE public.doctoralia_patients
        SET lead_id          = best_lid,
            match_confidence = best_score,
            match_class      = CASE
              WHEN best_score = 1.0 THEN 'exact_match'
              WHEN best_score >= 0.92 THEN 'high_confidence'
              ELSE 'possible_match'
            END
      WHERE doc_patient_id = patient_row.doc_patient_id AND clinic_id = patient_row.clinic_id;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.run_doctoralia_name_match() IS
  'Matching fuzzy entre doctoralia_patients y leads. search_path hardened 2026-05-31.';

-- 4. Eliminar función muerta is_service_role() (solo existía en migración obsoleta)
DROP FUNCTION IF EXISTS public.is_service_role();

-- 4. Comentario de consolidación
COMMENT ON FUNCTION public.current_clinic_id() IS 
  'Helper consolidado (20260531). Usar siempre como (SELECT public.current_clinic_id()).';

COMMENT ON FUNCTION public.current_user_id() IS 
  'Helper consolidado (20260531).';

COMMENT ON FUNCTION public.normalize_phone(TEXT) IS 
  'Hardened 2026-05-31: search_path seguro + simplificación de prefijos españoles.';

COMMENT ON FUNCTION public.run_doctoralia_name_match() IS 
  'Hardened 2026-05-31: search_path corregido (de '''' a public, pg_catalog).';

-- 5. Nota para el equipo
DO $$
BEGIN
  RAISE NOTICE 'Consolidación RLS + helpers completada.';
  RAISE NOTICE 'Funciones actualizadas: current_clinic_id, current_user_id, normalize_phone, run_doctoralia_name_match.';
  RAISE NOTICE 'Se recomienda ejecutar supabase db lint después de aplicar esta migración.';
END $$;

COMMIT;
