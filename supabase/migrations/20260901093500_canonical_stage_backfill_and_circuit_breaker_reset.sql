-- =============================================================================
-- Migration: Canonical stage backfill, default trigger, circuit breaker reset
--
-- Root causes addressed:
--   1. 792 leads (all 88 Doctoralia marketing leads and 596 Meta leadgen leads)
--      had stage_canonical = NULL because refresh_doctoralia_funnel was only
--      scoped to users with existing appointment matches, leaving other sources
--      unprocessed, and leads had no default on insert.
--   2. Adds trg_leads_default_stage_canonical so no future inserted lead can
--      ever have stage_canonical IS NULL.
--   3. Synchronizes patient_classification.funnel_status_canonical.
--   4. Resets the open circuit breaker in control_centre_provider_cache for
--      provider='google' to 'half_open' (failure_count=0) so the next cycle
--      can immediately re-test the provider.
--   5. Hardens nvx_get_hubspot_marketing_contact_monitor() by revoking
--      EXECUTE from authenticated and restricting to service_role.
-- =============================================================================

begin;

-- 1. Backfill stage_canonical for all leads where stage_canonical IS NULL
WITH resolved AS (
  SELECT
    l.id AS lead_id,
    CASE
      -- Lost / Perdido
      WHEN l.lost_reason IS NOT NULL
        OR lower(coalesce(l.stage::text, '')) IN ('lost', 'perdido')
        THEN 'perdido'
      -- Converted / Won
      WHEN coalesce(l.verified_revenue, 0) > 0
        OR lower(coalesce(l.stage::text, '')) IN ('won', 'cliente', 'convertido')
        THEN 'cliente'
      -- Attended appointment
      WHEN l.appointment_status::text IN ('showed', 'attended')
        OR l.attended_at IS NOT NULL
        THEN 'asistio'
      -- Scheduled appointment
      WHEN l.appointment_status::text IN ('scheduled')
        OR (l.appointment_date IS NOT NULL AND l.appointment_date >= now())
        THEN 'valoracion_aceptada'
      -- Patient responded inbound
      WHEN l.first_inbound_at IS NOT NULL
        THEN 'contacto'
      -- Outbound contact initiated
      WHEN l.first_outbound_at IS NOT NULL
        OR l.first_response_at IS NOT NULL
        THEN 'contactado'
      -- Default for unprocessed / new leads (including doctoralia_marketing)
      ELSE 'lead'
    END AS canonical_stage,
    coalesce(l.stage::text, 'unknown') AS original_stage
  FROM public.leads l
  WHERE l.stage_canonical IS NULL
    AND l.deleted_at IS NULL
    AND l.merged_into_lead_id IS NULL
)
UPDATE public.leads l
SET
  stage_canonical            = r.canonical_stage,
  stage_source               = coalesce(l.stage_source, r.original_stage, 'backfill_20260901'),
  stage_canonical_updated_at = pg_catalog.now(),
  updated_at                 = pg_catalog.now()
FROM resolved r
WHERE l.id = r.lead_id
  AND l.stage_canonical IS NULL;

-- 2. Ensure all newly inserted leads always have a non-null stage_canonical
CREATE OR REPLACE FUNCTION public.nvx_sync_default_stage_canonical()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.stage_canonical IS NULL THEN
    NEW.stage_canonical := 'lead';
    NEW.stage_source := coalesce(NEW.stage_source, NEW.stage, 'initial_capture');
    NEW.stage_canonical_updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nvx_default_stage_canonical ON public.leads;
CREATE TRIGGER trg_nvx_default_stage_canonical
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.nvx_sync_default_stage_canonical();

-- 3. Synchronize patient_classification.funnel_status_canonical
UPDATE public.patient_classification pc
SET
  funnel_status_canonical = l.stage_canonical,
  updated_at              = pg_catalog.now()
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical;

-- 4. Reset the Google Ads circuit breaker so the next provider refresh retries
UPDATE public.control_centre_provider_cache
SET
  breaker_state      = 'half_open',
  failure_count      = 0,
  breaker_open_until = NULL,
  lease_owner        = NULL,
  lease_until        = NULL,
  last_error         = coalesce(last_error, '') || ' [circuit breaker reset 2026-09-01]',
  updated_at         = pg_catalog.now()
WHERE provider = 'google'
  AND breaker_state = 'open';

-- 5. Revoke authenticated access from nvx_get_hubspot_marketing_contact_monitor
REVOKE ALL ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor()
  TO service_role;

commit;
