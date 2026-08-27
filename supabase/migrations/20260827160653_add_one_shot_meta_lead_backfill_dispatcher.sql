-- One-shot dispatcher for the canonical Meta Page-owned lead backfill.
-- This intentionally creates no pg_cron job. It encapsulates the internal
-- credential server-side and only returns the pg_net request id.

CREATE OR REPLACE FUNCTION public.nvx_dispatch_meta_lead_backfill_once(
  p_since date,
  p_until date DEFAULT CURRENT_DATE
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
  IF p_since IS NULL OR p_until IS NULL OR p_since > p_until THEN
    RAISE EXCEPTION 'Invalid backfill date window';
  END IF;

  IF p_until - p_since > 730 THEN
    RAISE EXCEPTION 'Backfill date window exceeds 730 days';
  END IF;

  SELECT decrypted_secret INTO v_secret
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
    url := v_project_url || '/functions/v1/meta-lead-backfill',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := pg_catalog.jsonb_build_object(
      'since', p_since::text,
      'until', p_until::text
    ),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(date,date) FROM anon;
REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(date,date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(date,date) TO service_role;
