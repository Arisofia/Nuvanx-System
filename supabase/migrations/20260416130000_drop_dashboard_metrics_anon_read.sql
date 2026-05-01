-- =============================================================================
-- Migration: Drop anon read on dashboard_metrics
-- =============================================================================
-- dashboard_metrics had a permissive anon_read policy so Figma Make could
-- bind to it.  That consumer (figmaClient.js) was removed — the frontend
-- now reads KPIs via the authenticated backend API.  Leaving anon_read
-- exposes business KPIs to anyone with the public anon key.
-- =============================================================================

DROP POLICY IF EXISTS dashboard_metrics_anon_read ON public.dashboard_metrics;

-- Ensure authenticated users can still read (e.g. future direct Supabase calls)
DROP POLICY IF EXISTS dashboard_metrics_authenticated_read ON public.dashboard_metrics;
ALTER TABLE public.dashboard_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY dashboard_metrics_authenticated_read ON public.dashboard_metrics
  FOR SELECT TO authenticated USING (TRUE);
