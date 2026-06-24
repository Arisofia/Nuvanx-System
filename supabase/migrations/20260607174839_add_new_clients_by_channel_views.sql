-- Migration: add_new_clients_by_channel_views
-- Description: Create views for new clients by channel (social, organic, paid, etc)
-- Applied: 2026-06-07T17:48:39Z

-- This migration was applied directly to the remote database via Supabase dashboard
-- and is being added to local repository to sync migration history

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS crm_stage TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

-- Create view for new clients by channel and month
CREATE OR REPLACE VIEW v_new_clients_by_channel_monthly AS
SELECT 
  DATE_TRUNC('month', l.created_at)::DATE as month,
  COALESCE(l.utm_source, 'direct') as channel,
  COUNT(DISTINCT l.id) as new_clients,
  COUNT(DISTINCT CASE WHEN l.crm_stage = 'converted' THEN l.id END) as converted,
  ROUND(
    COUNT(DISTINCT CASE WHEN l.crm_stage = 'converted' THEN l.id END)::NUMERIC / 
    NULLIF(COUNT(DISTINCT l.id), 0) * 100, 
    2
  ) as conversion_rate
FROM public.leads l
WHERE l.created_at >= NOW() - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', l.created_at), COALESCE(l.utm_source, 'direct')
ORDER BY month DESC, new_clients DESC;

-- Grant access to authenticated users
GRANT SELECT ON v_new_clients_by_channel_monthly TO authenticated;
GRANT SELECT ON v_new_clients_by_channel_monthly TO service_role;
