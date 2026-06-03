-- =============================================================================
-- Cleanup of dead / one-timer tables.
-- These tables have no (or negligible) active references in current frontend,
-- edge functions, scripts, or process flows.
-- They appear to be remnants from experiments, partial features (kpi system,
-- lead scoring, figma components, audit, design tokens, etc.), or old one-offs.
-- All active data flows (leads, financial_settlements, meta insights, doctoralia
-- raw/processed, integrations/credentials for config, playbooks, agents, etc.)
-- have clear origins (webhooks, sync scripts, daily-aggregates, UI saves, auth)
-- and outputs (CRM UI, Dashboard, Reports, Traceability, mcp tools, attribution,
-- kpis computation, etc.).
-- No dummy/example data is being inserted in active code paths.
-- Dropping these cleans the schema without affecting the live process.
-- =============================================================================

BEGIN;

-- Drop dead tables (IF EXISTS for safety in all envs)
DROP TABLE IF EXISTS public.agent_run_steps;
DROP TABLE IF EXISTS public.audit_log;
DROP TABLE IF EXISTS public.dashboard_metrics;
DROP TABLE IF EXISTS public.design_tokens;
DROP TABLE IF EXISTS public.doctoralia_lead_matches;
DROP TABLE IF EXISTS public.figma_components;
DROP TABLE IF EXISTS public.kpi_blocked;
DROP TABLE IF EXISTS public.kpi_definitions;
DROP TABLE IF EXISTS public.kpi_values;
DROP TABLE IF EXISTS public.lead_scores;
DROP TABLE IF EXISTS public.lead_timeline_events;
DROP TABLE IF EXISTS public.side_effect_locks;

-- Note: We keep figma_sync_log (actively used), api_call_log (used for logging),
-- appointments (base table for vw_doctor_performance_real used by Reports "Doctor Performance"),
-- doctors/treatment_types/patients (referenced in reports/live/kpis and doctoralia flows), etc.
-- Removed appointments from drops to avoid breaking dependent view (2BP01 dependency error).

COMMIT;

-- After this, re-run any necessary RLS or other if affected, but these were unused.