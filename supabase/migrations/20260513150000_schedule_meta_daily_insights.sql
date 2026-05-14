-- =============================================
-- AUTOMATIZACIÓN DIARIA DE META INSIGHTS (pg_cron)
-- =============================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Eliminar job anterior si existe
SELECT cron.unschedule('fetch-meta-daily-insights');

-- Nuevo job diario (5:00 AM hora del servidor Supabase)
SELECT cron.schedule(
    'fetch-meta-daily-insights',
    '0 5 * * *',        -- Todos los días a las 5:00 AM
    $$
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
    $$
);

COMMENT ON cron.job 'fetch-meta-daily-insights' IS 'Actualiza meta_daily_insights diariamente desde Meta Ads API';
