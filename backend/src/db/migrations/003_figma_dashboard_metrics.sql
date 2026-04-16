-- =============================================================================
-- Migration 002: dashboard_metrics table for Figma Make data binding
-- =============================================================================
-- Run this in the Figma Supabase project SQL Editor:
--   https://supabase.com/dashboard/project/zpowfbeftxexzidlxndy/sql/new
--
-- This creates a single-row table that the backend upserts on every sync.
-- Figma Make can connect to this table and bind any column to a text node.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.dashboard_metrics (
  id                     TEXT         PRIMARY KEY DEFAULT 'nuvanx-main',
  label                  TEXT         NOT NULL DEFAULT 'Nuvanx KPIs',

  -- Core KPIs
  total_leads            INTEGER      NOT NULL DEFAULT 0,
  total_revenue          NUMERIC(12,2) NOT NULL DEFAULT 0,
  connected_integrations INTEGER      NOT NULL DEFAULT 0,
  total_integrations     INTEGER      NOT NULL DEFAULT 0,

  -- Lead funnel stages
  leads_lead             INTEGER      NOT NULL DEFAULT 0,
  leads_whatsapp         INTEGER      NOT NULL DEFAULT 0,
  leads_appointment      INTEGER      NOT NULL DEFAULT 0,
  leads_treatment        INTEGER      NOT NULL DEFAULT 0,
  leads_closed           INTEGER      NOT NULL DEFAULT 0,

  -- Integration connection status (connected | disconnected | error)
  meta_status            TEXT         NOT NULL DEFAULT 'disconnected',
  whatsapp_status        TEXT         NOT NULL DEFAULT 'disconnected',
  github_status          TEXT         NOT NULL DEFAULT 'disconnected',
  openai_status          TEXT         NOT NULL DEFAULT 'disconnected',
  gemini_status          TEXT         NOT NULL DEFAULT 'disconnected',

  -- Metadata
  last_sync              TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Allow the backend service role to read/write freely
ALTER TABLE public.dashboard_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_metrics_service_role ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_service_role ON public.dashboard_metrics
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Allow anonymous read (Figma Make uses anon key for data binding)
DROP POLICY IF EXISTS dashboard_metrics_anon_read ON public.dashboard_metrics;
CREATE POLICY dashboard_metrics_anon_read ON public.dashboard_metrics
  FOR SELECT TO anon USING (TRUE);

-- Seed initial row so Figma can discover the schema immediately
INSERT INTO public.dashboard_metrics (id) VALUES ('nuvanx-main')
  ON CONFLICT (id) DO NOTHING;
