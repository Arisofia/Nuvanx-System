-- Replay bridge immediately before the restored 20260831140008 source-to-cash migration.
-- Clean Preview history has the patient identity core but is missing the email/name
-- normalization fields consumed by the applied Production view definition. Production
-- already carries these columns, so this migration is a no-op there.

ALTER TABLE IF EXISTS public.patients
  ADD COLUMN IF NOT EXISTS email varchar(255),
  ADD COLUMN IF NOT EXISTS email_normalized varchar(255),
  ADD COLUMN IF NOT EXISTS name_normalized text;

-- Preserve the canonical patient identity uniqueness already enforced in Production.
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_dni_uq
  ON public.patients (clinic_id, dni)
  WHERE dni IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_dni_hash_uq
  ON public.patients (clinic_id, dni_hash)
  WHERE dni_hash IS NOT NULL;
