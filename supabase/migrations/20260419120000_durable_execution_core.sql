-- Durable execution core for playbook runtime and lead scoring

CREATE TABLE IF NOT EXISTS public.side_effect_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL,
  playbook_id UUID NULL REFERENCES public.playbooks(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS side_effect_locks_user_id_idx ON public.side_effect_locks(user_id);
CREATE INDEX IF NOT EXISTS side_effect_locks_created_at_idx ON public.side_effect_locks(created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.playbook_executions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  playbook_id UUID NULL REFERENCES public.playbooks(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'dead_letter')),
  metadata JSONB NOT NULL DEFAULT '{}',
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS agent_runs_user_id_idx ON public.agent_runs(user_id);
CREATE INDEX IF NOT EXISTS agent_runs_status_idx ON public.agent_runs(status);
CREATE INDEX IF NOT EXISTS agent_runs_created_at_idx ON public.agent_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 1,
  output JSONB NOT NULL DEFAULT '{}',
  error TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_id_idx ON public.agent_run_steps(run_id);
CREATE INDEX IF NOT EXISTS agent_run_steps_created_at_idx ON public.agent_run_steps(created_at DESC);

CREATE TABLE IF NOT EXISTS public.lead_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  method TEXT NOT NULL CHECK (method IN ('ai', 'heuristic')),
  reason TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_scores_lead_id_idx ON public.lead_scores(lead_id);
CREATE INDEX IF NOT EXISTS lead_scores_user_id_idx ON public.lead_scores(user_id);
CREATE INDEX IF NOT EXISTS lead_scores_created_at_idx ON public.lead_scores(created_at DESC);

ALTER TABLE public.side_effect_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS side_effect_locks_service_role ON public.side_effect_locks;
CREATE POLICY side_effect_locks_service_role ON public.side_effect_locks
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS agent_runs_service_role ON public.agent_runs;
CREATE POLICY agent_runs_service_role ON public.agent_runs
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS agent_run_steps_service_role ON public.agent_run_steps;
CREATE POLICY agent_run_steps_service_role ON public.agent_run_steps
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS lead_scores_service_role ON public.lead_scores;
CREATE POLICY lead_scores_service_role ON public.lead_scores
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
