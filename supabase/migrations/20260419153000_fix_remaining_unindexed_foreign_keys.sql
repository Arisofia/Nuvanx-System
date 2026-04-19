-- Fix remaining unindexed foreign keys reported by Supabase advisors

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id_fk_cover
  ON public.agent_run_steps(run_id);

CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id_fk_cover
  ON public.appointments(clinic_id);

CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_id_fk_cover
  ON public.lead_scores(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_timeline_events_lead_id_fk_cover
  ON public.lead_timeline_events(lead_id);

CREATE INDEX IF NOT EXISTS idx_playbooks_owner_user_id_fk_cover
  ON public.playbooks(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_clinic_id_fk_cover
  ON public.whatsapp_conversations(clinic_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lead_id_fk_cover
  ON public.whatsapp_conversations(lead_id);

ANALYZE public.agent_run_steps;
ANALYZE public.appointments;
ANALYZE public.lead_scores;
ANALYZE public.lead_timeline_events;
ANALYZE public.playbooks;
ANALYZE public.whatsapp_conversations;
