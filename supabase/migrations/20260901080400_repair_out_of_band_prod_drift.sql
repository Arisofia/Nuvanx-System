-- Forward-only repair for the 2026-09-01 out-of-band Production drift.
-- Preserve 20260901080000..080300 as immutable audit history; correct their effects here.

-- 1. Restore the Google Ads credential contract.
-- credentials.encrypted_key stores the AES-GCM envelope for the Google Ads developer token.
-- The service-account JSON belongs in Edge runtime secret GOOGLE_ADS_SERVICE_ACCOUNT.
ALTER TABLE public.credentials
  DROP CONSTRAINT IF EXISTS check_google_ads_credential_length;

-- A plaintext service-account private key must not remain in a slot the runtime decrypts as a
-- developer token. Delete the malformed row instead of replacing it with another non-ciphertext
-- sentinel that could later be passed to the decryptor.
DELETE FROM public.credentials
WHERE service = 'google_ads'
  AND pg_catalog.left(pg_catalog.ltrim(encrypted_key), 1) = '{';

UPDATE public.integrations
SET status = 'credential_invalid',
    last_error = 'Google Ads developer token must be reprovisioned through the encrypted credential path',
    metadata = coalesce(metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'credential_quarantine_reason', 'plaintext_service_account_removed_from_developer_token_slot',
      'credential_quarantined_at', pg_catalog.now()
    ),
    updated_at = pg_catalog.now()
WHERE service = 'google_ads';

-- 2. Replace the hard-coded Meta coverage view with the actual runtime canonical account.
-- Normalize optional act_ prefixes and enforce invoker security so RLS/permissions belong to the caller.
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

-- 3. Repair the helper introduced by 080300 so the Advisor no longer reports a mutable search_path.
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

-- 4. Restore the pre-existing canonical legacy-stage owner instead of inventing a second taxonomy.
-- The actual Control Centre pipeline remains vw_control_centre_pipeline; this only repairs the legacy debug fields.
DO $repair_legacy_stage$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT l.user_id
    FROM public.leads l
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND l.user_id IS NOT NULL
    ORDER BY l.user_id
  LOOP
    PERFORM public.refresh_doctoralia_funnel(v_user_id);
  END LOOP;
END;
$repair_legacy_stage$;

UPDATE public.leads
SET stage_source = coalesce(nullif(stage_source, ''), stage),
    stage_canonical_updated_at = coalesce(stage_canonical_updated_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
WHERE deleted_at IS NULL
  AND merged_into_lead_id IS NULL
  AND (stage_source IS NULL OR stage_source = '' OR stage_canonical_updated_at IS NULL);

COMMENT ON VIEW public.vw_meta_account_coverage IS
'Coverage by Meta ad account. Runtime canonical classification is derived from the connected meta_ads integration marked metadata.canonical=true; no reporting account is hard-coded.';
