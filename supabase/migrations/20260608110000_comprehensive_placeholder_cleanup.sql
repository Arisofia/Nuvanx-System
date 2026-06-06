-- =============================================================================
-- Migration: Comprehensive Placeholder Cleanup
-- Purpose: Cleans up invalid phone placeholders and records with missing IDs
--          that might have been imported from dirty Google Sheets data.
-- =============================================================================

BEGIN;

-- 1. Update normalization function to be more aggressive with placeholders
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

  -- Reject obvious fake/placeholder phones (all same digits: 000..., 111..., or sequential 123...)
  IF cleaned ~ '^(\d)\1+$' OR cleaned = '123456789' THEN
    RETURN NULL;
  END IF;

  -- Remove Spanish prefixes
  IF cleaned LIKE '0034%' THEN
    cleaned := substring(cleaned FROM 5);
  ELSIF cleaned LIKE '34%' AND length(cleaned) > 9 THEN
    cleaned := substring(cleaned FROM 3);
  END IF;

  cleaned := regexp_replace(cleaned, '[^0-9]', '', 'g');

  IF cleaned = '' OR cleaned ~ '^(\d)\1+$' THEN
    RETURN NULL;
  END IF;

  -- Spanish phones must be at least 9 digits
  IF length(cleaned) < 9 THEN
    RETURN NULL;
  END IF;

  -- Return only last 9 digits for matching
  RETURN right(cleaned, 9);
END;
$$;

-- 2. Clean up existing tables
-- Nullify normalized phones that are now considered placeholders
UPDATE public.financial_settlements
SET phone_normalized = NULL,
    updated_at = NOW()
WHERE phone_normalized IS NOT NULL 
  AND public.normalize_phone(patient_phone) IS NULL;

UPDATE public.leads
SET phone_normalized = NULL,
    updated_at = NOW()
WHERE phone_normalized IS NOT NULL
  AND public.normalize_phone(phone) IS NULL;

-- 3. Remove doctoralia_patients that only had placeholder info and no valid ID
-- If doc_patient_id starts with 'ph:' and that phone is now invalid
DELETE FROM public.doctoralia_patients
WHERE doc_patient_id LIKE 'ph:%'
  AND public.normalize_phone(substring(doc_patient_id from 4)) IS NULL;

-- 4. Clean up doctoralia_patients names that are placeholders
UPDATE public.doctoralia_patients
SET full_name = NULL,
    name_norm = NULL,
    updated_at = NOW()
WHERE full_name ~* '^(test|prueba|desconocido|unknown|n/a|-|\.)$';

-- 5. Re-run patient sync to fix any broken links after normalization change
SELECT public.sync_doctoralia_patients();

COMMIT;
