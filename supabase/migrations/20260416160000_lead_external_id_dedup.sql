-- =============================================================================
-- Lead deduplication: add external_id column + unique constraint.
--
-- external_id stores the source-system identifier (e.g. Meta leadgen_id,
-- WhatsApp wa_id) so that repeated webhook deliveries of the same event are
-- idempotent — the second INSERT hits the UNIQUE constraint and is silently
-- discarded via ON CONFLICT DO NOTHING in the application layer.
--
-- The constraint is PARTIAL (WHERE external_id IS NOT NULL) so that manually
-- created leads (external_id = NULL) are never blocked from insertion.
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS leads_external_id_idx
  ON leads (user_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Partial unique index: only enforce uniqueness when external_id is set.
CREATE UNIQUE INDEX IF NOT EXISTS leads_user_source_external_id_uq
  ON leads (user_id, source, external_id)
  WHERE external_id IS NOT NULL;
