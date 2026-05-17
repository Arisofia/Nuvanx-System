-- =============================================
-- AUTOMATIZACIÓN DIARIA DE META INSIGHTS (pg_cron)
-- =============================================

-- Habilitar la extensión pg_cron si no existe
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Asegurar idempotencia: si existe un job previo con este nombre, eliminarlo primero.
-- Usar jobid evita el camino de cron.unschedule(jobname), que puede fallar cuando
-- la metadata nominal del job está obsoleta en Supabase Preview.
DO $$
DECLARE
  target_job RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR target_job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'fetch-meta-daily-insights'
    LOOP
      BEGIN
        PERFORM cron.unschedule(target_job.jobid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Ignoring stale pg_cron metadata for fetch-meta-daily-insights jobid %: %',
          target_job.jobid,
          SQLERRM;
      END;
    END LOOP;

    DELETE FROM cron.job
    WHERE jobname = 'fetch-meta-daily-insights';

    -- Nuevo job diario (5:00 AM hora del servidor Supabase)
    PERFORM cron.schedule(
      'fetch-meta-daily-insights',
      '0 5 * * *',        -- Todos los días a las 5:00 AM
      $job$
      SELECT net.http_post(
        url := 'https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/daily-aggregates',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('SUPABASE_SERVICE_ROLE_KEY', true),
          'x-user-id', 'system-daily-job',
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'action', 'fetch_meta_insights',
          'days', 2
        )
      );
      $job$
    );
  END IF;
END;
$$;
