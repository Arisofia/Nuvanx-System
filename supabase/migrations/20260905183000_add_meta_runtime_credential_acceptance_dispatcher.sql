-- Canonical Meta runtime credential acceptance dispatcher.
-- Keeps REVOPS_INTERNAL_SECRET inside Postgres/Vault and returns only the pg_net request id.

CREATE OR REPLACE FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance()
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
  SELECT decrypted_secret
  INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_INTERNAL_SECRET'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Internal runtime acceptance credential unavailable';
  END IF;

  SELECT trim(decrypted_secret)
  INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_PROJECT_URL'
  LIMIT 1;

  IF v_project_url IS NULL OR v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RAISE EXCEPTION 'Environment-local project URL unavailable';
  END IF;

  SELECT net.http_post(
    url := v_project_url || '/functions/v1/meta-runtime-credential-acceptance',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() FROM anon;
REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() TO service_role;
