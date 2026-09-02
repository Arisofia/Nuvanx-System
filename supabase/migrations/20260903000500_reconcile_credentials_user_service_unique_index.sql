-- Forward-only reconciliation for the canonical credentials upsert contract.
--
-- Production already has credentials_user_id_service_key on
-- public.credentials(user_id, service), but clean replay does not currently
-- recreate that invariant. Google Ads runtime-owned provisioning relies on
-- ON CONFLICT (user_id, service), so keep the migration history deterministic
-- without modifying any previously applied migration.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS credentials_user_id_service_key
  ON public.credentials (user_id, service);

COMMIT;
