-- Retire residual Meta provisioning/backfill helpers that are no longer part of runtime.
-- Both functions are service_role-only, have no cron jobs, repository consumers,
-- or PostgreSQL dependents. Historical migrations remain immutable.

DROP FUNCTION IF EXISTS public.nvx_get_meta_lead_backfill_token();

DROP FUNCTION IF EXISTS public.provision_meta_ads_credential_once(
  uuid, uuid, uuid, text, text, text, text, text, text, text
);
