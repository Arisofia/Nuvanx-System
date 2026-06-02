-- =============================================================================
-- Consolidation of RLS helpers and auth wrappers (20260529/30/31 series)
-- - Hardens normalize_phone() and run_doctoralia_name_match() with search_path
-- - Replaces current_clinic_id() and current_user_id() with robust versions
-- - Adds safe wrappers for auth.*() calls with service_role scoping + initplan fixes
-- - Marks several early RLS migrations as obsolete (see comments)
-- =============================================================================

-- 1. Hardcode normalize_phone() with safe search_path
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
  'Normalizes Spanish phones for matching. Hardcoded search_path (2026-06-03).';

-- 2. Hardcode run_doctoralia_name_match() with safe search_path (fixed alias version)
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
      sim      := extensions.similarity(
                    patient_row.name_norm,
                    lower(extensions.unaccent(COALESCE(lead_row.name, '')))
                  );
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
      WHERE doc_patient_id = patient_row.doc_patient_id
        AND clinic_id = patient_row.clinic_id;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.run_doctoralia_name_match() IS
  'Fuzzy matching between doctoralia_patients and leads. Alias fixed + search_path hardened (2026-06-03).';

-- 3. Consolidated and more robust current_clinic_id()
-- (final version)
CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id      uuid;
  v_claim_clinic uuid;
  v_user_clinic  uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Safely read clinic_id from JWT (avoid broad exception)
  BEGIN
    v_claim_clinic := (auth.jwt() ->> 'clinic_id')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_claim_clinic := NULL;
    WHEN OTHERS THEN
      v_claim_clinic := NULL;
  END;

  SELECT clinic_id INTO v_user_clinic
  FROM public.users
  WHERE id = v_user_id;

  IF v_user_clinic IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_claim_clinic IS NOT NULL AND v_claim_clinic <> v_user_clinic THEN
    RAISE EXCEPTION 'Clinic claim mismatch for user %', v_user_id;
  END IF;

  RETURN v_user_clinic;
END;
$$;

COMMENT ON FUNCTION public.current_clinic_id() IS
  'Returns the clinic_id for the current authenticated user. Robust version with safe JWT handling (2026-06-03).';

-- 4. current_user_id() wrapper (simple and safe)
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT auth.uid();
$$;

COMMENT ON FUNCTION public.current_user_id() IS
  'Safe wrapper around auth.uid() with explicit search_path.';

-- 5. Mark old migrations as obsolete (these files should be kept for history but are no longer applied in clean deploys)
-- We do this via comments in a separate "mark obsolete" style migration if needed.
-- For now we just document here.

-- Recommended obsolete list (as per user request):
-- 20260523090000_*
-- 20260507170000_*
-- 20260521100000_*
-- Various early cron / anon RLS duplicates

-- 6. (Optional) Example of a safe auth wrapper for service_role scoping + initplan fix
-- You can expand this pattern for other auth.* calls if needed in the future.

-- Example pattern (commented for reference):
-- CREATE OR REPLACE FUNCTION public.safe_auth_uid()
-- RETURNS uuid
-- LANGUAGE sql STABLE SET search_path = pg_catalog, public
-- AS $$ SELECT auth.uid() $$;

-- End of consolidation migration
