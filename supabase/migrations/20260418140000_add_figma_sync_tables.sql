-- Migration: Add figma_components and figma_sync_log tables
-- These are used by backend/src/services/figmaSync.js (publishSnapshotToFigma)
-- Both supabaseAdmin (nuvanx-prod) and supabaseFigmaAdmin point to this project.

-- ── figma_components ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.figma_components (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key      TEXT NOT NULL,
  component_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  component_type TEXT DEFAULT 'component',
  metadata      JSONB NOT NULL DEFAULT '{}',
  last_synced   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_key, component_id)
);

ALTER TABLE public.figma_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY figma_components_service_role ON public.figma_components
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.figma_components IS
  'Figma component registry — last_synced updated on each figmaSync run.';

-- ── figma_sync_log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.figma_sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_key          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'success'
                      CHECK (status IN ('success', 'error', 'partial')),
  message           TEXT DEFAULT '',
  components_synced INTEGER NOT NULL DEFAULT 0,
  tokens_synced     INTEGER NOT NULL DEFAULT 0,
  error_detail      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.figma_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY figma_sync_log_service_role ON public.figma_sync_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.figma_sync_log IS
  'Audit log for each figmaSync run — written by publishSnapshotToFigma.';
