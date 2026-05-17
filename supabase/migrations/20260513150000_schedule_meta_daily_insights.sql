-- =============================================
-- AUTOMATIZACIÓN DIARIA DE META INSIGHTS (pg_cron)
-- =============================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Recreate the job idempotently. Some Supabase/pg_cron installations can keep a
-- stale named-job row that makes cron.unschedule(jobname) raise
-- "could not find valid entry"; deleting the row first avoids the broken
-- named-unschedule path before cron.schedule registers the canonical job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
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
