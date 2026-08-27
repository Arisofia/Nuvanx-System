-- Follow-up hardening after the Control Centre metrics correction.
-- Production ledger version: 20260827163057.
--
-- 1) Restore security_invoker on the campaign-performance view explicitly.
-- 2) Replace the global two-argument Meta backfill dispatcher with an explicit
--    user-scoped dispatcher so multi-clinic/multi-owner installations remain safe.

ALTER VIEW public.vw_campaign_performance_real SET (security_invoker = true);

DROP FUNCTION IF EXISTS public.nvx_dispatch_meta_lead_backfill_once(date,date);

CREATE OR REPLACE FUNCTION public.nvx_dispatch_meta_lead_backfill_once(
  p_user_id uuid,
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
  v_has_connected_meta boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Backfill user_id is required';
  END IF;

  IF p_since IS NULL OR p_until IS NULL OR p_since > p_until THEN
    RAISE EXCEPTION 'Invalid backfill date window';
  END IF;

  IF p_until - p_since > 730 THEN
    RAISE EXCEPTION 'Backfill date window exceeds 730 days';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.integrations i
    WHERE i.user_id = p_user_id
      AND i.service = 'meta_ads'
      AND i.status = 'connected'
      AND COALESCE((i.metadata->>'canonical')::boolean, false) = true
  ) INTO v_has_connected_meta;

  IF NOT v_has_connected_meta THEN
    RAISE EXCEPTION 'Canonical connected meta_ads integration not found for user';
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
      'user_id', p_user_id::text,
      'since', p_since::text,
      'until', p_until::text
    ),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(uuid,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(uuid,date,date) FROM anon;
REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(uuid,date,date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_meta_lead_backfill_once(uuid,date,date) TO service_role;
