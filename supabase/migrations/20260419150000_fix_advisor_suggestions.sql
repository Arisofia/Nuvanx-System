-- Supabase Advisor Fixes — April 19, 2026
-- Fix 18 unindexed foreign keys + 39 unused indexes

-- ─── Part 1: Add Missing Foreign Key Indexes ───────────────────────────────

-- agent_outputs foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_outputs_clinic_id 
  ON public.agent_outputs(clinic_id);

-- agent_runs foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runs_execution_id 
  ON public.agent_runs(execution_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_runs_playbook_id 
  ON public.agent_runs(playbook_id);

-- appointments foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_doctor_id 
  ON public.appointments(doctor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_patient_id 
  ON public.appointments(patient_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_treatment_type_id 
  ON public.appointments(treatment_type_id);

-- doctors foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doctors_clinic_id 
  ON public.doctors(clinic_id);

-- financial_settlements foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_financial_settlements_patient_id 
  ON public.financial_settlements(patient_id);

-- kpi_values foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_kpi_values_kpi_id 
  ON public.kpi_values(kpi_id);

-- leads foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_assigned_to 
  ON public.leads(assigned_to);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_converted_patient_id 
  ON public.leads(converted_patient_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_doctor_id 
  ON public.leads(doctor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_treatment_type_id 
  ON public.leads(treatment_type_id);

-- playbook_executions foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_playbook_executions_agent_output_id 
  ON public.playbook_executions(agent_output_id);

-- side_effect_locks foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_side_effect_locks_playbook_id 
  ON public.side_effect_locks(playbook_id);

-- treatment_types foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_treatment_types_clinic_id 
  ON public.treatment_types(clinic_id);

-- users foreign keys
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_clinic_id 
  ON public.users(clinic_id);

-- ─── Part 2: Drop Unused Indexes ──────────────────────────────────────────

-- Public schema unused indexes
DROP INDEX CONCURRENTLY IF EXISTS public.audit_log_resource_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.clinics_active_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.playbooks_owner_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.settlements_dni_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.settlements_dni_hash_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.settlements_template_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.appointments_clinic_date_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_user_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_stage_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_external_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_campaign_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_phone_norm_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_dni_hash_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_no_show_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_phone_normalized_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.leads_campaign_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.patients_clinic_dni_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.patients_clinic_phone_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.patients_dni_hash_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.patients_phone_normalized_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.wa_conv_lead_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.wa_conv_phone_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.wa_conv_clinic_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.meta_attribution_campaign_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.meta_attribution_lead_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.timeline_lead_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.doctoralia_raw_upload_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.agent_outputs_agent_type_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.side_effect_locks_user_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.side_effect_locks_created_at_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.agent_runs_status_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.agent_run_steps_run_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.agent_run_steps_created_at_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.lead_scores_lead_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.lead_scores_user_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.lead_scores_created_at_idx;

-- Monitoring schema unused indexes
DROP INDEX CONCURRENTLY IF EXISTS monitoring.operational_events_user_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS monitoring.operational_events_created_at_idx;
DROP INDEX CONCURRENTLY IF EXISTS monitoring.commands_user_id_idx;
DROP INDEX CONCURRENTLY IF EXISTS monitoring.commands_status_idx;

-- ─── Part 3: Analyze Tables ────────────────────────────────────────────────
-- Update optimizer statistics for all affected tables
ANALYZE public.agent_outputs;
ANALYZE public.agent_runs;
ANALYZE public.appointments;
ANALYZE public.doctors;
ANALYZE public.financial_settlements;
ANALYZE public.kpi_values;
ANALYZE public.leads;
ANALYZE public.playbook_executions;
ANALYZE public.side_effect_locks;
ANALYZE public.treatment_types;
ANALYZE public.users;
ANALYZE public.patients;
ANALYZE public.whatsapp_conversations;
ANALYZE public.meta_attribution;
ANALYZE public.lead_timeline_events;
ANALYZE public.doctoralia_raw;
ANALYZE public.agent_run_steps;
ANALYZE public.lead_scores;
