-- Forward-only repair after 20260901080000..080300 and 20260901093500 were already
-- applied to Production. Do not edit/replay those applied versions to repair their effects.
--
-- Google Ads Service Account health is intentionally NOT an acceptance dependency here.
-- This migration does not reset/close the Google provider circuit breaker.

begin;

-- 1. Restore the credential-slot contract.
-- public.credentials.encrypted_key is the encrypted Google Ads developer-token slot.
-- A service-account JSON must never live here. Remove only visibly plaintext JSON rows;
-- the Service Account itself is managed independently via Edge runtime secrets.
ALTER TABLE public.credentials
  DROP CONSTRAINT IF EXISTS check_google_ads_credential_length;

WITH quarantined_credentials AS (
  DELETE FROM public.credentials
  WHERE service = 'google_ads'
    AND pg_catalog.left(pg_catalog.ltrim(encrypted_key), 1) = '{'
  RETURNING user_id, clinic_id
)
UPDATE public.integrations i
SET status = 'credential_invalid',
    last_error = 'Google Ads developer-token credential requires governed reprovisioning',
    metadata = coalesce(i.metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'credential_quarantine_reason', 'plaintext_service_account_removed_from_developer_token_slot',
      'credential_quarantined_at', pg_catalog.now()
    ),
    updated_at = pg_catalog.now()
WHERE i.service = 'google_ads'
  AND EXISTS (
    SELECT 1
    FROM quarantined_credentials q
    WHERE q.user_id IS NOT DISTINCT FROM i.user_id
      AND q.clinic_id IS NOT DISTINCT FROM i.clinic_id
  );

-- 2. Repair Meta reporting coverage without hard-coding a historical account.
-- Use caller permissions/RLS and derive the canonical account from the connected meta_ads row.
CREATE OR REPLACE VIEW public.vw_meta_account_coverage
WITH (security_invoker = true)
AS
WITH runtime_canonical AS (
  SELECT pg_catalog.regexp_replace(
           coalesce(i.metadata->>'adAccountId', i.metadata->>'ad_account_id', ''),
           '^act_',
           ''
         ) AS canonical_account_id
  FROM public.integrations i
  WHERE i.service = 'meta_ads'
    AND i.status = 'connected'
    AND pg_catalog.lower(coalesce(i.metadata->>'canonical', 'false')) = 'true'
  ORDER BY i.updated_at DESC, i.id
  LIMIT 1
)
SELECT
  mdi.ad_account_id,
  pg_catalog.count(*) AS total_insights,
  pg_catalog.max(mdi.date) AS last_insight_date,
  CASE
    WHEN rc.canonical_account_id <> ''
     AND pg_catalog.regexp_replace(mdi.ad_account_id, '^act_', '') = rc.canonical_account_id
      THEN 'canonical_runtime'
    ELSE 'historical_or_noncanonical'
  END AS classification
FROM public.meta_daily_insights mdi
LEFT JOIN runtime_canonical rc ON true
GROUP BY mdi.ad_account_id, rc.canonical_account_id;

COMMENT ON VIEW public.vw_meta_account_coverage IS
'Coverage by Meta ad account. Canonical classification is derived from the connected meta_ads integration marked metadata.canonical=true; no reporting account is hard-coded.';

-- 3. Repair the helper introduced by 080300 so its search_path is immutable.
CREATE OR REPLACE FUNCTION public.nvx_assert_non_anonymous_session()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
BEGIN
  v_claims := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  IF coalesce(v_claims->>'is_anonymous', 'false') = 'true' THEN
    RAISE EXCEPTION 'Anonymous access is not allowed for this operation.';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.nvx_assert_non_anonymous_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nvx_assert_non_anonymous_session() TO authenticated, service_role;

-- 4. Materialize the corrected trigger logic that exists in Git after #442 but was not
-- re-applied to Production because 093500 had already been recorded there.
CREATE OR REPLACE FUNCTION public.nvx_sync_default_stage_canonical()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.stage_canonical IS NULL THEN
    NEW.stage_canonical := CASE
      WHEN NEW.lost_reason IS NOT NULL
        OR pg_catalog.lower(coalesce(NEW.stage, '')) IN ('lost', 'perdido')
        THEN 'perdido'
      WHEN coalesce(NEW.verified_revenue, 0) > 0
        OR pg_catalog.lower(coalesce(NEW.stage, '')) IN ('won', 'cliente', 'convertido', 'closed')
        THEN 'cliente'
      WHEN pg_catalog.lower(coalesce(NEW.appointment_status::text, '')) IN ('showed', 'attended')
        OR NEW.attended_at IS NOT NULL
        OR pg_catalog.lower(coalesce(NEW.stage, '')) = 'asistio'
        THEN 'asistio'
      WHEN pg_catalog.lower(coalesce(NEW.appointment_status::text, '')) = 'scheduled'
        OR pg_catalog.lower(coalesce(NEW.stage, '')) IN ('appointment', 'valoracion_aceptada')
        OR (NEW.appointment_date IS NOT NULL AND NEW.appointment_date >= pg_catalog.now())
        THEN 'valoracion_aceptada'
      WHEN NEW.first_inbound_at IS NOT NULL
        OR pg_catalog.lower(coalesce(NEW.stage, '')) IN ('whatsapp', 'contacto')
        THEN 'contacto'
      WHEN NEW.first_outbound_at IS NOT NULL
        OR NEW.first_response_at IS NOT NULL
        OR pg_catalog.lower(coalesce(NEW.stage, '')) = 'contactado'
        THEN 'contactado'
      WHEN NEW.stage IS NOT NULL AND pg_catalog.lower(pg_catalog.btrim(NEW.stage)) NOT IN ('', 'lead')
        THEN NULL
      ELSE 'lead'
    END;

    IF NEW.stage_canonical IS NOT NULL THEN
      NEW.stage_source := coalesce(NEW.stage_source, NEW.stage, 'initial_capture');
      NEW.stage_canonical_updated_at := pg_catalog.now();
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_nvx_default_stage_canonical ON public.leads;
CREATE TRIGGER trg_nvx_default_stage_canonical
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.nvx_sync_default_stage_canonical();

-- 5. Repair rows flattened to 'lead' by 080200. This is a legacy/debug field repair only;
-- vw_control_centre_pipeline remains the operational Control Centre pipeline owner.
WITH resolved AS (
  SELECT
    l.id AS lead_id,
    CASE
      WHEN l.lost_reason IS NOT NULL
        OR pg_catalog.lower(coalesce(l.stage::text, '')) IN ('lost', 'perdido')
        THEN 'perdido'
      WHEN coalesce(l.verified_revenue, 0) > 0
        OR pg_catalog.lower(coalesce(l.stage::text, '')) IN ('won', 'cliente', 'convertido', 'closed')
        THEN 'cliente'
      WHEN l.appointment_status::text IN ('showed', 'attended')
        OR l.attended_at IS NOT NULL
        OR pg_catalog.lower(coalesce(l.stage::text, '')) = 'asistio'
        THEN 'asistio'
      WHEN l.appointment_status::text = 'scheduled'
        OR pg_catalog.lower(coalesce(l.stage::text, '')) IN ('appointment', 'valoracion_aceptada')
        OR (l.appointment_date IS NOT NULL AND l.appointment_date >= pg_catalog.now())
        THEN 'valoracion_aceptada'
      WHEN l.first_inbound_at IS NOT NULL
        OR pg_catalog.lower(coalesce(l.stage::text, '')) IN ('whatsapp', 'contacto')
        THEN 'contacto'
      WHEN l.first_outbound_at IS NOT NULL
        OR l.first_response_at IS NOT NULL
        OR pg_catalog.lower(coalesce(l.stage::text, '')) = 'contactado'
        THEN 'contactado'
      WHEN l.stage IS NOT NULL AND pg_catalog.lower(pg_catalog.btrim(l.stage::text)) NOT IN ('', 'lead')
        THEN NULL
      ELSE 'lead'
    END AS canonical_stage,
    coalesce(l.stage::text, 'unknown') AS original_stage
  FROM public.leads l
  WHERE (l.stage_canonical IS NULL OR l.stage_canonical = 'lead')
    AND l.deleted_at IS NULL
    AND l.merged_into_lead_id IS NULL
)
UPDATE public.leads l
SET stage_canonical = r.canonical_stage,
    stage_source = coalesce(nullif(l.stage_source, ''), r.original_stage, 'backfill_20260901'),
    stage_canonical_updated_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
FROM resolved r
WHERE l.id = r.lead_id
  AND (l.stage_canonical IS NULL OR l.stage_canonical = 'lead')
  AND l.stage_canonical IS DISTINCT FROM r.canonical_stage;

UPDATE public.patient_classification pc
SET funnel_status_canonical = l.stage_canonical,
    updated_at = pg_catalog.now()
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical;

commit;
