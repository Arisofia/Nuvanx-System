-- Migration: Add patient_phone to financial_settlements, backfill, index, and repopulate
-- doctoralia_patients with phone-based matching (phone-only rows were skipped in migration
-- 20260506100000 because the ELSE branch ran when patient_phone did not yet exist).

-- Step 1: Add the column unconditionally (idempotent).
ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS patient_phone TEXT;

-- Step 2: Backfill patient_phone from patients.phone if that column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'patients'
      AND column_name  = 'phone'
  ) THEN
    UPDATE public.financial_settlements fs
    SET patient_phone = p.phone
    FROM public.patients p
    WHERE fs.patient_phone IS NULL
      AND fs.patient_id    = p.id
      AND p.phone IS NOT NULL;
  END IF;
END $$;

-- Step 3: Index for clinic + phone lookups (idempotent).
CREATE INDEX IF NOT EXISTS financial_settlements_patient_phone_idx
  ON public.financial_settlements (clinic_id, patient_phone)
  WHERE patient_phone IS NOT NULL;

-- Step 4: Re-populate doctoralia_patients including phone-only rows that were skipped
-- in 20260506100000.  Use correct single-backslash regex inside plain SQL (no EXECUTE wrapper).
INSERT INTO public.doctoralia_patients (
  doc_patient_id, clinic_id, full_name, name_norm, phone_primary, first_seen_at,
  match_confidence, match_class
)
SELECT
  COALESCE(
    NULLIF(fs.patient_dni, ''),
    'ph:' || NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\D', '', 'g'), '')
  ) AS doc_patient_id,
  fs.clinic_id,
  UPPER(TRIM(fs.patient_name)) AS full_name,
  LOWER(REGEXP_REPLACE(extensions.unaccent(TRIM(fs.patient_name)), '\s+', ' ', 'g')) AS name_norm,
  NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\D', '', 'g'), '') AS phone_primary,
  MIN(fs.settled_at) AS first_seen_at,
  NULL AS match_confidence,
  NULL AS match_class
FROM public.financial_settlements fs
WHERE fs.cancelled_at IS NULL
  AND fs.patient_name  IS NOT NULL
  AND fs.amount_net    > 0
  AND COALESCE(
        NULLIF(fs.patient_dni, ''),
        NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\D', '', 'g'), '')
      ) IS NOT NULL
GROUP BY fs.clinic_id, fs.patient_dni, fs.patient_phone, fs.patient_name
ON CONFLICT (doc_patient_id, clinic_id) DO UPDATE
SET full_name     = EXCLUDED.full_name,
    name_norm     = EXCLUDED.name_norm,
    phone_primary = COALESCE(EXCLUDED.phone_primary, public.doctoralia_patients.phone_primary),
    first_seen_at = LEAST(public.doctoralia_patients.first_seen_at, EXCLUDED.first_seen_at);

-- Step 5: Fill phone_primary for existing DNI rows that have phone data in the settlements.
UPDATE public.doctoralia_patients dp
SET phone_primary = sub.phone_norm
FROM (
  SELECT
    NULLIF(fs.patient_dni, '') AS doc_patient_id,
    fs.clinic_id,
    MAX(NULLIF(regexp_replace(COALESCE(fs.patient_phone, ''), '\D', '', 'g'), '')) AS phone_norm
  FROM public.financial_settlements fs
  WHERE NULLIF(fs.patient_dni, '') IS NOT NULL
  GROUP BY fs.patient_dni, fs.clinic_id
) sub
WHERE dp.phone_primary   IS NULL
  AND dp.doc_patient_id   = sub.doc_patient_id
  AND dp.clinic_id        = sub.clinic_id
  AND sub.phone_norm      IS NOT NULL;

SELECT public.run_doctoralia_name_match();
