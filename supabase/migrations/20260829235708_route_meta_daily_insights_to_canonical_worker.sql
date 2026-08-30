CREATE OR REPLACE FUNCTION public.nvx_dispatch_maintenance_worker(
  p_worker text,
  p_from date,
  p_to date
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_project_url text;
  v_url text;
  v_body jsonb;
  v_request_id bigint;
BEGIN
  IF p_worker NOT IN ('meta-lead-backfill','meta-daily-insights') THEN
    RAISE EXCEPTION 'Unsupported maintenance worker';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid maintenance date range';
  END IF;
  IF (p_to - p_from) > 93 THEN
    RAISE EXCEPTION 'Maintenance date range exceeds 93 days';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_INTERNAL_SECRET'
  LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Internal maintenance credential unavailable';
  END IF;

  SELECT trim(decrypted_secret) INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_PROJECT_URL'
  LIMIT 1;
  IF v_project_url IS NULL OR v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RAISE EXCEPTION 'Environment-local project URL unavailable';
  END IF;

  IF p_worker = 'meta-lead-backfill' THEN
    v_url := v_project_url || '/functions/v1/meta-lead-backfill';
    v_body := pg_catalog.jsonb_build_object('since', p_from::text, 'until', p_to::text);
  ELSE
    v_url := v_project_url || '/functions/v1/meta-daily-insights';
    v_body := pg_catalog.jsonb_build_object('from', p_from::text, 'to', p_to::text);
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := v_body,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_dispatch_maintenance_worker(text,date,date) FROM public;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_maintenance_worker(text,date,date) TO service_role;

DO $$
DECLARE
  v_job RECORD;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'fetch-meta-daily-insights'
  LOOP
    PERFORM cron.alter_job(
      v_job.jobid,
      command := $$select public.nvx_dispatch_maintenance_worker('meta-daily-insights', current_date - 2, current_date);$$,
      active := true
    );
  END LOOP;
END;
$$;
