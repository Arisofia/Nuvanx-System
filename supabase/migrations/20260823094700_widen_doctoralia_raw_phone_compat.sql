-- Compatibility hardening for the LIVE Doctoralia projection.
--
-- The canonical Doctoralia source occasionally contains two real phone values in
-- one source cell. Historical normalization can therefore produce >16 characters
-- (for example, two 9-digit numbers concatenated). `doctoralia_raw` is a legacy
-- compatibility/realtime projection and must preserve the source without truncation.
--
-- Note: phone_primary was already declared as TEXT in 20260504190000_doctoralia_raw_normalization.sql.
-- Attempting to alter it to varchar(32) or TEXT again triggers PostgreSQL view dependency errors
-- (ERROR: cannot alter type of a column used by a view or rule) for vw_doctoralia_trazabilidad_360.
-- Since the column is already TEXT in any environment that successfully ran the 190000 migration,
-- this migration is a safe NO-OP to unblock CI.

BEGIN;
SELECT 1;
COMMIT;
