-- =============================================================================
-- Improve normalize_phone to reject fake all-zero placeholder phones
-- (seen in Doctoralia/Listado exports: 000000000, 0000000000, etc.)
-- Also backfill existing bad data so phone-based matching/reconciliation
-- ignores them (falls back to name/DNI/etc where available).
-- =============================================================================

BEGIN;

-- 1. Enhanced normalize_phone that rejects all-zero fakes + keeps prior logic
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

  -- Reject obvious fake/placeholder phones from bad exports (Listado/Doctoralia 000...)
  IF cleaned ~ '^0+$' THEN
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

  -- Also reject if became all zeros after stripping
  IF cleaned ~ '^0+$' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone(TEXT) IS
  'Normalizes Spanish phones for matching. Rejects all-zero fakes (000000000 etc). Updated 2026-06-05.';

-- 2. Backfill: clear fake phone_normalized from prior imports of dirty Doctoralia/Listado data.
--    This prevents bogus matches in reconciliation / attribution / traceability.
--    Safe: only affects all-zero strings; real phones starting with 0 after prefix strip are rare and would have been 00... anyway.

UPDATE public.financial_settlements
SET phone_normalized = NULL,
    updated_at = NOW()
WHERE phone_normalized ~ '^0+$';

UPDATE public.leads
SET phone_normalized = NULL,
    updated_at = NOW()
WHERE phone_normalized ~ '^0+$';

UPDATE public.produccion_intermediarios
SET phone_normalized = NULL,
    updated_at = NOW()
WHERE phone_normalized ~ '^0+$';

-- doctoralia_patients may store raw or primary phones; normalize on use, but clean if has normalized col
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='doctoralia_patients' AND column_name='phone_normalized'
  ) THEN
    UPDATE public.doctoralia_patients
    SET phone_normalized = NULL,
        updated_at = NOW()
    WHERE phone_normalized ~ '^0+$';
  END IF;
END $$;

-- 3. Security (re-grant in case)
REVOKE ALL ON FUNCTION public.normalize_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_phone(TEXT) TO service_role;

COMMIT;