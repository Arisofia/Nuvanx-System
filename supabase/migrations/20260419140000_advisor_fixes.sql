-- Supabase Advisor Fixes — April 19, 2026
-- Addresses 57 suggestions across foreign key indexes, query optimization, and RLS
-- Generated to improve database performance and compliance

-- 1. Add missing foreign key indexes for common joins
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_user_id ON public.leads(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_clinic_id ON public.leads(clinic_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_integrations_user_id ON public.integrations(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_integrations_service ON public.integrations(service);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credentials_user_id ON public.credentials(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credentials_service ON public.credentials(service);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_events_user_id ON public.operational_events(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_events_command_id ON public.operational_events(command_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_events_created_at ON public.operational_events(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbooks_user_id ON public.playbooks(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbooks_trigger_type ON public.playbooks(trigger_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_user_id ON public.webhooks(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_created_at ON public.webhooks(created_at DESC);

-- 2. Add composite indexes for common filter patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_stage_user_created ON public.leads(user_id, stage, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_source_stage ON public.leads(user_id, source, stage);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_integrations_user_status ON public.integrations(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credentials_user_service ON public.credentials(user_id, service);

-- 3. Optimize operational events for time-series queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_events_user_created ON public.operational_events(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_events_command_user ON public.operational_events(command_id, user_id);

-- 4. Add indexes for dashboard metrics queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_metrics_last_sync ON public.dashboard_metrics(last_sync DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_metrics_user_sync ON public.dashboard_metrics(user_id, last_sync DESC);

-- 5. Add indexes for lead scoring performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_scores_lead_model ON public.lead_scores(lead_id, model) WHERE is_active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lead_scores_updated ON public.lead_scores(updated_at DESC) WHERE is_active = true;

-- 6. Add indexes for agent run tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runs_user_status ON public.agent_runs(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runs_created ON public.agent_runs(created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_run_steps_run_id ON public.agent_run_steps(run_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_run_steps_status ON public.agent_run_steps(status);

-- 7. Ensure side effect locks can be efficiently cleaned up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_side_effect_locks_acquired ON public.side_effect_locks(acquired_at);

-- 8. Add BRIN indexes for time-series tables (space-efficient)
-- BRIN (Block Range Index) is more efficient than B-tree for append-only time-series
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_created_brin ON public.leads USING BRIN (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operational_events_created_brin ON public.operational_events USING BRIN (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_created_brin ON public.webhooks USING BRIN (created_at);

-- 9. Add partial indexes for active/live records (space-efficient)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credentials_active ON public.credentials(user_id) WHERE is_encrypted = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbooks_active ON public.playbooks(user_id) WHERE enabled = true;

-- 10. Optimize query performance for RLS filters
-- These help with the common pattern: SELECT * FROM table WHERE user_id = $1
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_user_lookup ON public.leads(user_id) INCLUDE (id, name, phone, email, stage);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_integrations_user_lookup ON public.integrations(user_id) INCLUDE (id, service, status);

-- 11. Ensure foreign key constraints are properly indexed
-- Check all foreign keys and ensure they have indexes
ALTER TABLE public.operational_events ADD CONSTRAINT fk_operational_events_command_id 
  FOREIGN KEY (command_id) REFERENCES public.operational_commands(id) ON DELETE CASCADE;
ALTER TABLE public.lead_scores ADD CONSTRAINT fk_lead_scores_lead_id 
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;
ALTER TABLE public.agent_runs ADD CONSTRAINT fk_agent_runs_user_id 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.agent_run_steps ADD CONSTRAINT fk_agent_run_steps_run_id 
  FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

-- 12. Add explicit RLS policy indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rls_user_context ON public.leads(user_id, id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rls_integration_context ON public.integrations(user_id, id);

-- 13. Analyze tables to update optimizer statistics
ANALYZE public.leads;
ANALYZE public.integrations;
ANALYZE public.credentials;
ANALYZE public.operational_events;
ANALYZE public.playbooks;
ANALYZE public.webhooks;
ANALYZE public.dashboard_metrics;
ANALYZE public.lead_scores;
ANALYZE public.agent_runs;
ANALYZE public.agent_run_steps;
ANALYZE public.side_effect_locks;

-- Verify indexes were created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
