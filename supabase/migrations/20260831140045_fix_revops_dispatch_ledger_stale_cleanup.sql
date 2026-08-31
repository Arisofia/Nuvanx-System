
-- Limpieza de filas stuck en estado 'dispatched' > 2h
-- y función + cron para prevenir acumulación futura.

-- 1. Limpiar filas stuck actuales (deal-factory 5 filas ~34h, meta-capi-dispatch 2 filas ~34h)
UPDATE public.revops_dispatch_ledger
SET status        = 'timeout',
    error_message = 'Stale dispatch: resolved by cleanup migration 2026-08-31 (> 2h in dispatched)',
    resolved_at   = NOW()
WHERE status = 'dispatched'
  AND dispatched_at < NOW() - INTERVAL '2 hours';

-- 2. Función reutilizable para cleanup periódico
CREATE OR REPLACE FUNCTION public.nvx_cleanup_stale_dispatch_ledger(
  p_stale_threshold_minutes integer DEFAULT 120
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.revops_dispatch_ledger
  SET status        = 'timeout',
      error_message = format('Stale dispatch: auto-timeout after %s minutes in dispatched state',
                              p_stale_threshold_minutes),
      resolved_at   = pg_catalog.now()
  WHERE status = 'dispatched'
    AND dispatched_at < pg_catalog.now() - (p_stale_threshold_minutes || ' minutes')::interval;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$fn$;

REVOKE ALL ON FUNCTION public.nvx_cleanup_stale_dispatch_ledger(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_cleanup_stale_dispatch_ledger(integer) TO service_role;

COMMENT ON FUNCTION public.nvx_cleanup_stale_dispatch_ledger IS
'Marca como timeout cualquier fila de revops_dispatch_ledger stuck en dispatched > N minutos. Por defecto 120 min.';

-- 3. Cron: ejecutar cada hora para evitar acumulación
DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job
    WHERE jobname = 'nvx-revops-dispatch-stale-cleanup'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END $$;

SELECT cron.schedule(
  'nvx-revops-dispatch-stale-cleanup',
  '37 * * * *',  -- cada hora en el minuto 37 para evitar colisión con otros crons
  $cron$SELECT public.nvx_cleanup_stale_dispatch_ledger(120);$cron$
);
