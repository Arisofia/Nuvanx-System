-- #336: Implement persistent pg_net dispatch ledger and asynchronous reconciliation.
--
-- Records every pg_net HTTP dispatch with its request_id and enables
-- reconciliation of asynchronous HTTP responses against net._http_response.

-- 1. Table: public.revops_dispatch_ledger
CREATE TABLE IF NOT EXISTS public.revops_dispatch_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id BIGINT NOT NULL,
  worker TEXT NOT NULL,
  mode TEXT,
  limit_val INTEGER NOT NULL DEFAULT 25,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'dispatched'
    CONSTRAINT revops_dispatch_ledger_status_check
    CHECK (status IN ('dispatched', 'completed', 'failed', 'timeout')),
  http_status INTEGER,
  response_body JSONB,
  error_message TEXT,
  resolved_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_revops_dispatch_ledger_request_id
  ON public.revops_dispatch_ledger (request_id);

CREATE INDEX IF NOT EXISTS idx_revops_dispatch_ledger_status
  ON public.revops_dispatch_ledger (status, dispatched_at DESC);

CREATE INDEX IF NOT EXISTS idx_revops_dispatch_ledger_worker
  ON public.revops_dispatch_ledger (worker, dispatched_at DESC);

-- RLS & Grants
ALTER TABLE public.revops_dispatch_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.revops_dispatch_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.revops_dispatch_ledger TO service_role;

DROP POLICY IF EXISTS revops_dispatch_ledger_service_role_all ON public.revops_dispatch_ledger;
CREATE POLICY revops_dispatch_ledger_service_role_all
  ON public.revops_dispatch_ledger
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. Update nvx_dispatch_revops_worker to record dispatches in ledger
CREATE OR REPLACE FUNCTION public.nvx_dispatch_revops_worker(
  p_worker TEXT,
  p_limit INTEGER DEFAULT 25,
  p_mode TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret TEXT;
  v_project_url TEXT;
  v_limit INTEGER;
  v_mode TEXT;
  v_body JSONB;
  v_request_id BIGINT;
BEGIN
  IF p_worker NOT IN ('web-lead-reconcile', 'deal-factory', 'google-data-manager-export') THEN
    RAISE EXCEPTION 'Unsupported RevOps worker';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
  v_mode := NULLIF(TRIM(COALESCE(p_mode, '')), '');
  IF p_worker = 'google-data-manager-export' THEN
    IF v_mode IS NOT NULL AND v_mode NOT IN ('deliver', 'poll') THEN
      RAISE EXCEPTION 'Unsupported Google Data Manager mode';
    END IF;
  ELSIF v_mode IS NOT NULL THEN
    RAISE EXCEPTION 'Worker mode is only valid for Google Data Manager';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_INTERNAL_SECRET'
  LIMIT 1;
  IF v_secret IS NULL OR LENGTH(v_secret) < 32 THEN
    RAISE EXCEPTION 'Internal worker credential unavailable';
  END IF;

  SELECT TRIM(decrypted_secret) INTO v_project_url
  FROM vault.decrypted_secrets
  WHERE name = 'REVOPS_PROJECT_URL'
  LIMIT 1;
  IF v_project_url IS NULL OR v_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' THEN
    RAISE EXCEPTION 'Environment-local RevOps project URL unavailable';
  END IF;

  v_body := pg_catalog.jsonb_build_object('worker', p_worker, 'limit', v_limit);
  IF v_mode IS NOT NULL THEN
    v_body := v_body || pg_catalog.jsonb_build_object('mode', v_mode);
  END IF;

  SELECT net.http_post(
    url := v_project_url || '/functions/v1/revops-dispatcher',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nvx-internal-secret', v_secret
    ),
    body := v_body,
    timeout_milliseconds := 5000
  ) INTO v_request_id;

  IF v_request_id IS NOT NULL THEN
    INSERT INTO public.revops_dispatch_ledger (
      request_id,
      worker,
      mode,
      limit_val,
      dispatched_at,
      status
    ) VALUES (
      v_request_id,
      p_worker,
      v_mode,
      v_limit,
      pg_catalog.clock_timestamp(),
      'dispatched'
    );
  END IF;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_dispatch_revops_worker(TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_dispatch_revops_worker(TEXT, INTEGER, TEXT) TO service_role;

-- 3. Function to reconcile async dispatch responses from net._http_response
CREATE OR REPLACE FUNCTION public.nvx_reconcile_dispatch_ledger(
  p_lookback_minutes INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reconciled INTEGER := 0;
  v_timed_out INTEGER := 0;
  v_row RECORD;
  v_resp RECORD;
  v_parsed_body JSONB;
BEGIN
  -- Reconcile pending/dispatched entries
  FOR v_row IN
    SELECT l.id, l.request_id, l.dispatched_at
    FROM public.revops_dispatch_ledger l
    WHERE l.status = 'dispatched'
      AND l.dispatched_at >= pg_catalog.now() - (GREATEST(1, LEAST(p_lookback_minutes, 1440)) || ' minutes')::INTERVAL
    ORDER BY l.dispatched_at ASC
    LIMIT 200
  LOOP
    -- Look up in net._http_response
    BEGIN
      SELECT r.status_code, r.content, r.error_msg
      INTO v_resp
      FROM net._http_response r
      WHERE r.id = v_row.request_id
      LIMIT 1;

      IF FOUND THEN
        v_parsed_body := NULL;
        IF v_resp.content IS NOT NULL AND TRIM(v_resp.content) <> '' THEN
          BEGIN
            v_parsed_body := v_resp.content::JSONB;
          EXCEPTION WHEN OTHERS THEN
            v_parsed_body := pg_catalog.jsonb_build_object('raw', v_resp.content);
          END;
        END IF;

        UPDATE public.revops_dispatch_ledger
        SET status = CASE
              WHEN v_resp.status_code >= 200 AND v_resp.status_code < 300 THEN 'completed'
              ELSE 'failed'
            END,
            http_status = v_resp.status_code,
            response_body = v_parsed_body,
            error_message = v_resp.error_msg,
            resolved_at = pg_catalog.clock_timestamp()
        WHERE id = v_row.id;

        v_reconciled := v_reconciled + 1;
      ELSIF v_row.dispatched_at < pg_catalog.now() - INTERVAL '5 minutes' THEN
        -- Timeout unresolved after 5 minutes
        UPDATE public.revops_dispatch_ledger
        SET status = 'timeout',
            error_message = 'Asynchronous HTTP dispatch timed out without response record',
            resolved_at = pg_catalog.clock_timestamp()
        WHERE id = v_row.id;

        v_timed_out := v_timed_out + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- In case net._http_response schema is inaccessible or undergoing maintenance
      NULL;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'reconciled', v_reconciled,
    'timed_out', v_timed_out,
    'timestamp', pg_catalog.clock_timestamp()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_reconcile_dispatch_ledger(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_reconcile_dispatch_ledger(INTEGER) TO service_role;
