-- Compatibility hardening for the LIVE Doctoralia projection.
--
-- The canonical Doctoralia source occasionally contains two real phone values in
-- one source cell. Historical normalization can therefore produce >16 characters
-- (for example, two 9-digit numbers concatenated). `doctoralia_raw` is a legacy
-- compatibility/realtime projection and must preserve the source without truncation.
-- This migration runs after the already-applied campaign report migration and
-- before the LIVE mirror backfill.

BEGIN;

ALTER TABLE public.doctoralia_raw
  ALTER COLUMN phone_primary TYPE TEXT,
  ALTER COLUMN phone_secondary TYPE TEXT;

COMMIT;
