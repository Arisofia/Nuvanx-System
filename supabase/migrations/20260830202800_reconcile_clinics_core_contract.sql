-- Replay bridge for public.clinics.
-- The early Preview compatibility scaffold only creates id/name/metadata/created_at,
-- while later applied migrations (starting at 20260830202904) consume the canonical
-- multi-clinic contract. This migration is intentionally ordered immediately before
-- that first consumer. It is idempotent and is a no-op/normalization on Production,
-- where these columns and constraints already exist.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS slug varchar(100),
  ADD COLUMN IF NOT EXISTS plan varchar(50) NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS country varchar(64),
  ADD COLUMN IF NOT EXISTS timezone varchar(64) NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.clinics
  ALTER COLUMN name TYPE varchar(255) USING name::varchar(255),
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN plan SET DEFAULT 'starter',
  ALTER COLUMN plan SET NOT NULL,
  ALTER COLUMN timezone SET DEFAULT 'UTC',
  ALTER COLUMN timezone SET NOT NULL,
  ALTER COLUMN settings SET DEFAULT '{}'::jsonb,
  ALTER COLUMN settings SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $clinics_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.clinics'::regclass
      AND c.conname = 'clinics_slug_key'
  ) THEN
    ALTER TABLE public.clinics
      ADD CONSTRAINT clinics_slug_key UNIQUE (slug);
  END IF;
END;
$clinics_contract$;

CREATE INDEX IF NOT EXISTS clinics_slug_idx
  ON public.clinics (slug);
