-- Service-role-only dispatcher for Google Ads backfills.
-- GitHub authenticates only to PostgREST. The database keeps the internal
-- worker secret server-side and dispatches to the Edge runtime through pg_net.

CREATE OR REPLACE FUNCTION public.nvx_dispatch_google_ads_backfill_once(
  p_from date,
  p_to date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
  v_project_url text;
  v_request_id bigint;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid Google Ads backfill date window';
  END IF;

  IF p_to - p_from > 91 THEN
    RAISE EXCEPTION 'Google Ads backfill date window exceeds 92 days';
  END IF;

  SELECT trim(decrypted_secret) INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_INTERNAL_SECRET'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Internal worker credential unavailable';
  END IF;

  SELECT trim(decrypted_secret) INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_PROJECT_URL'
  LIMIT 1;

  IF v_project_url IS NULL OR v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RAISE EXCEPTION 'Environment-local project URL unavailable';
  END IF;

  SELECT net.http_post(
    url := v_project_url || '/functions/v1/google-ads-backfill-dispatcher',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := pg_catalog.jsonb_build_object(
      'from', p_from::text,
      'to', p_to::text
    ),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.nvx_dispatch_google_ads_backfill_once(date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_dispatch_google_ads_backfill_once(date,date) FROM anon;
REVOKE ALL ON FUNCTION public.nvx_dispatch_google_ads_backfill_once(date,date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_google_ads_backfill_once(date,date) TO service_role;

CREATE OR REPLACE FUNCTION public.nvx_get_google_ads_backfill_response(
  p_request_id bigint
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN r.id IS NULL THEN pg_catalog.jsonb_build_object('ready', false)
    ELSE pg_catalog.jsonb_build_object(
      'ready', true,
      'status_code', r.status_code,
      'timed_out', r.timed_out,
      'error_msg', r.error_msg,
      'content', r.content
    )
  END
  FROM (SELECT p_request_id AS requested_id) q
  LEFT JOIN net._http_response r ON r.id = q.requested_id;
$function$;

REVOKE ALL ON FUNCTION public.nvx_get_google_ads_backfill_response(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_get_google_ads_backfill_response(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.nvx_get_google_ads_backfill_response(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_get_google_ads_backfill_response(bigint) TO service_role;
