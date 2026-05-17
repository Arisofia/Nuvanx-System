-- =============================================
-- AUTOMATIZACIÓN DIARIA DE META INSIGHTS (pg_cron)
-- =============================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Recreate the job idempotently. Some Supabase/pg_cron installations can keep
-- stale named-job metadata that makes cron.unschedule(jobname), or the implicit
-- unschedule inside cron.schedule(jobname, ...), raise "could not find valid
-- entry". Try the public API first, fall back to removing the stale cron.job
-- row, then schedule the canonical job exactly once.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('fetch-meta-daily-insights')
      WHERE EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'fetch-meta-daily-insights'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Ignoring stale pg_cron metadata for fetch-meta-daily-insights: %', SQLERRM;
    END;

    DELETE FROM cron.job
    WHERE jobname = 'fetch-meta-daily-insights';

    PERFORM cron.schedule(
      'fetch-meta-daily-insights',
      '0 5 * * *',        -- Todos los días a las 5:00 AM
      $cmd$
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
      $cmd$
    );
  END IF;
END $$;
