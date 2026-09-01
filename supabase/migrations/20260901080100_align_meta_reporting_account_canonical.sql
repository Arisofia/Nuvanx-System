-- Align Meta Reporting Account Canonical

-- Create audit view for Meta account coverage
CREATE OR REPLACE VIEW public.vw_meta_account_coverage AS
SELECT 
    ad_account_id,
    COUNT(*) as total_insights,
    MAX(date) as last_insight_date,
    CASE 
        WHEN ad_account_id = '9523446201036125' THEN 'canonical_reporting'
        ELSE 'operational_sync'
    END as classification
FROM public.meta_daily_insights
GROUP BY ad_account_id;

-- Add index on ad_account_id for dashboard queries
CREATE INDEX IF NOT EXISTS idx_meta_daily_insights_ad_account_id ON public.meta_daily_insights(ad_account_id);

-- Register canonical reporting account in metadata
UPDATE public.integrations
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{canonical_reporting_account}', '"9523446201036125"')
WHERE service = 'meta';
