-- =============================================================================
-- Figma Supabase project (zpowfbeftxexzidlxndy) — dashboard_metrics table
-- Apply to: https://supabase.com/dashboard/project/zpowfbeftxexzidlxndy/sql/new
-- OR run: npm run supabase:figma:migration:push
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dashboard_metrics (
  id TEXT PRIMARY KEY DEFAULT 'nuvanx-main',
  label TEXT NOT NULL DEFAULT 'Nuvanx KPIs',
  total_leads INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  connected_integrations INTEGER NOT NULL DEFAULT 0,
  total_integrations INTEGER NOT NULL DEFAULT 0,
  leads_lead INTEGER NOT NULL DEFAULT 0,
  leads_whatsapp INTEGER NOT NULL DEFAULT 0,
  leads_appointment INTEGER NOT NULL DEFAULT 0,
  leads_treatment INTEGER NOT NULL DEFAULT 0,
  leads_closed INTEGER NOT NULL DEFAULT 0,
  hubspot_status TEXT NOT NULL DEFAULT 'disconnected',
  meta_status TEXT NOT NULL DEFAULT 'disconnected',
  whatsapp_status TEXT NOT NULL DEFAULT 'disconnected',
  github_status TEXT NOT NULL DEFAULT 'disconnected',
  openai_status TEXT NOT NULL DEFAULT 'disconnected',
  gemini_status TEXT NOT NULL DEFAULT 'disconnected',
  last_sync TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.dashboard_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_metrics_service_role ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_service_role ON public.dashboard_metrics
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS dashboard_metrics_anon_read ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_anon_read ON public.dashboard_metrics
  FOR SELECT TO anon USING (TRUE);

INSERT INTO public.dashboard_metrics (id)
VALUES ('nuvanx-main')
ON CONFLICT (id) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public.dashboard_metrics;
