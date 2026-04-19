-- =============================================================================
-- Durable Execution Core
-- =============================================================================
-- Extends playbook_executions with durability tracking columns.
-- Adds agent_run_steps (per-step audit trail), side_effect_locks (idempotency),
-- and lead_scores (AI scoring with full provenance).
-- Adds reconciliation_status tracking columns to financial_settlements.
-- Seeds the doctoralia-batch-ingest playbook.
-- =============================================================================

-- 1. Extend playbook_executions with durability columns
ALTER TABLE public.playbook_executions
  ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS finished_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_message    TEXT,
  ADD COLUMN IF NOT EXISTS attempt          INT         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS idempotency_key  TEXT;

-- Non-unique partial index for idempotency-key lookups.
-- Retries may create additional playbook_executions rows with the same
-- idempotency_key, so uniqueness must be enforced by side_effect_locks
-- (or by runner logic), not by the execution row itself.
CREATE INDEX IF NOT EXISTS playbook_executions_idempotency_key_idx
  ON public.playbook_executions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Update the status check to include 'running' and 'skipped' states
ALTER TABLE public.playbook_executions
  DROP CONSTRAINT IF EXISTS playbook_executions_status_check;

ALTER TABLE public.playbook_executions
  ADD CONSTRAINT playbook_executions_status_check
  CHECK (status IN ('running', 'success', 'failed', 'skipped'));

-- 2. agent_run_steps: per-step audit trail for every execution
CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID        NOT NULL REFERENCES public.playbook_executions(id) ON DELETE CASCADE,
  step_index   INT         NOT NULL,
  step_name    TEXT,
  status       TEXT        NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  output       JSONB       NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_id_idx ON public.agent_run_steps(run_id);

ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;

-- Service role bypass for backend writes
DROP POLICY IF EXISTS agent_run_steps_service_role ON public.agent_run_steps;
CREATE POLICY agent_run_steps_service_role ON public.agent_run_steps
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Steps are readable by the user who owns the parent run
DROP POLICY IF EXISTS agent_run_steps_user ON public.agent_run_steps;
CREATE POLICY agent_run_steps_user ON public.agent_run_steps
  FOR SELECT USING (
    run_id IN (
      SELECT id FROM public.playbook_executions WHERE user_id = auth.uid()
    )
  );

-- 3. side_effect_locks: DB-level idempotency to prevent duplicate step execution
CREATE TABLE IF NOT EXISTS public.side_effect_locks (
  idempotency_key  TEXT        PRIMARY KEY,
  run_id           UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.side_effect_locks ENABLE ROW LEVEL SECURITY;

-- Locks are backend-only; no user-facing reads needed
DROP POLICY IF EXISTS side_effect_locks_service_role ON public.side_effect_locks;
CREATE POLICY side_effect_locks_service_role ON public.side_effect_locks
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- 4. lead_scores: AI scoring results with full provenance
CREATE TABLE IF NOT EXISTS public.lead_scores (
  lead_id     UUID          PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  score       NUMERIC(5,2),
  provider    TEXT,
  model       TEXT,
  version     INT           NOT NULL DEFAULT 1,
  scored_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  rationale   JSONB         NOT NULL DEFAULT '{}'
);

ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_scores_user ON public.lead_scores;
CREATE POLICY lead_scores_user ON public.lead_scores
  FOR ALL USING (
    lead_id IN (SELECT id FROM public.leads WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS lead_scores_service_role ON public.lead_scores;
CREATE POLICY lead_scores_service_role ON public.lead_scores
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- 5. Reconciliation tracking columns on financial_settlements
ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS reconciliation_status     TEXT    DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending', 'matched', 'no_match', 'manual')),
  ADD COLUMN IF NOT EXISTS reconciliation_reason     TEXT,
  ADD COLUMN IF NOT EXISTS reconciliation_confidence NUMERIC(5,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS financial_settlements_recon_status_idx
  ON public.financial_settlements(reconciliation_status)
  WHERE reconciliation_status = 'no_match';

-- 6. Seed: doctoralia-batch-ingest playbook
INSERT INTO public.playbooks (slug, title, description, category, status, steps) VALUES
  (
    'doctoralia-batch-ingest',
    'Doctoralia Batch Ingestion',
    'Asynchronous batch processing of Doctoralia settlement exports — upserts patients and financial records, then reconciles leads in the background.',
    'Operations',
    'active',
    '["Validate row schema","Upsert patients and financial_settlements","Run reconcile_patient_leads per patient","Emit completion event"]'
  )
ON CONFLICT (slug) DO UPDATE SET
  title       = EXCLUDED.title,
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  status      = EXCLUDED.status,
  steps       = EXCLUDED.steps,
  updated_at  = NOW();
