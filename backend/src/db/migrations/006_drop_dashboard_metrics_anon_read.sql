-- =============================================================================
-- Migration 006: Drop anon read on dashboard_metrics
-- =============================================================================
-- Mirror of supabase/migrations/20260416130000_drop_dashboard_metrics_anon_read.sql

DROP POLICY IF EXISTS dashboard_metrics_anon_read ON public.dashboard_metrics;

DROP POLICY IF EXISTS dashboard_metrics_authenticated_read ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_authenticated_read ON public.dashboard_metrics
  FOR SELECT TO authenticated USING (TRUE);
