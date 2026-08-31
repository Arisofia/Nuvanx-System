-- Consolidate RevOps async outcome reconciliation into one canonical owner.
-- Supersedes the temporary nvx_cleanup_stale_dispatch_ledger helper and raw-body persistence.

CREATE OR REPLACE FUNCTION public.nvx_reconcile_dispatch_ledger(
  p_lookback_minutes integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_reconciled integer := 0;
  v_timed_out integer := 0;
  v_stale integer := 0;
  v_row record;
  v_resp record;
BEGIN
  IF p_lookback_minutes IS NULL
     OR p_lookback_minutes < 1
     OR p_lookback_minutes > 1440 THEN
    RAISE EXCEPTION 'p_lookback_minutes must be between 1 and 1440'
      USING ERRCODE = '22023';
  END IF;

  -- Enrich recent dispatches while pg_net response records are still expected to exist.
  FOR v_row IN
    SELECT l.id, l.request_id
    FROM public.revops_dispatch_ledger l
    WHERE l.status = 'dispatched'
      AND l.dispatched_at >= pg_catalog.now()
        - pg_catalog.make_interval(mins => p_lookback_minutes)
    ORDER BY l.dispatched_at ASC
    LIMIT 200
  LOOP
    SELECT r.status_code, r.error_msg
    INTO v_resp
    FROM net._http_response r
    WHERE r.id = v_row.request_id
    LIMIT 1;

    IF FOUND THEN
      UPDATE public.revops_dispatch_ledger
      SET status = CASE
            WHEN v_resp.status_code >= 200 AND v_resp.status_code < 300 THEN 'completed'
            ELSE 'failed'
          END,
          http_status = v_resp.status_code,
          response_body = NULL,
          error_message = CASE
            WHEN v_resp.error_msg IS NOT NULL
              THEN pg_catalog.left(v_resp.error_msg, 1000)
            WHEN v_resp.status_code < 200 OR v_resp.status_code >= 300
              THEN pg_catalog.format('Provider HTTP status %s', v_resp.status_code)
            ELSE NULL
          END,
          resolved_at = pg_catalog.clock_timestamp()
      WHERE id = v_row.id;

      v_reconciled := v_reconciled + 1;
    END IF;
  END LOOP;

  -- Terminalize every stale dispatch, even after pg_net has purged its response row.
  UPDATE public.revops_dispatch_ledger
  SET status = 'timeout',
      response_body = NULL,
      error_message = 'Asynchronous HTTP dispatch response unavailable after terminal SLA',
      resolved_at = pg_catalog.clock_timestamp()
  WHERE status = 'dispatched'
    AND dispatched_at < pg_catalog.now() - INTERVAL '5 minutes';

  GET DIAGNOSTICS v_stale = ROW_COUNT;
  v_timed_out := v_timed_out + v_stale;

  RETURN pg_catalog.jsonb_build_object(
    'reconciled', v_reconciled,
    'timed_out', v_timed_out,
    'timestamp', pg_catalog.clock_timestamp()
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.nvx_reconcile_dispatch_ledger(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_reconcile_dispatch_ledger(integer)
  TO service_role;

COMMENT ON FUNCTION public.nvx_reconcile_dispatch_ledger(integer) IS
'Canonical durable pg_net outcome reconciler. Stores bounded status/error diagnostics only and terminalizes stale dispatches independent of response retention.';

-- Existing response bodies are redundant once terminal HTTP status is persisted.
-- At migration time Production has terminal status + http_status for every non-null response_body row.
UPDATE public.revops_dispatch_ledger
SET response_body = NULL
WHERE response_body IS NOT NULL
  AND status IN ('completed', 'failed', 'timeout');

-- Remove duplicate/temporary scheduler owners by jobname, never by generated job id.
DO $cleanup_jobs$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'nvx-revops-dispatch-stale-cleanup',
      'nvx-revops-dispatch-reconcile'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$cleanup_jobs$;

DROP FUNCTION IF EXISTS public.nvx_cleanup_stale_dispatch_ledger(integer);

SELECT cron.schedule(
  'nvx-revops-dispatch-reconcile',
  '*/10 * * * *',
  $cron$SELECT public.nvx_reconcile_dispatch_ledger(60);$cron$
);
