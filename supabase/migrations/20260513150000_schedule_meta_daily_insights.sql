-- =============================================
-- AUTOMATIZACIÓN DIARIA DE META INSIGHTS (pg_cron)
-- =============================================

-- Habilitar la extensión pg_cron si no existe
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
      $cmd$
    );
  END IF;
END $$;
