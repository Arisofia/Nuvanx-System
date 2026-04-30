-- Fix remaining unindexed foreign keys reported by Supabase advisors.
-- NOTE: CI databases can be created from a subset of historical objects.
-- Guard each index/analyze statement so this migration is idempotent on clean DBs.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_run_steps'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id_fk_cover
      ON public.agent_run_steps(run_id);
    ANALYZE public.agent_run_steps;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id_fk_cover
      ON public.appointments(clinic_id);
    ANALYZE public.appointments;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lead_scores'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_id_fk_cover
      ON public.lead_scores(lead_id);
    ANALYZE public.lead_scores;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'lead_timeline_events'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_lead_timeline_events_lead_id_fk_cover
      ON public.lead_timeline_events(lead_id);
    ANALYZE public.lead_timeline_events;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'playbooks' AND column_name = 'owner_user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_playbooks_owner_user_id_fk_cover
      ON public.playbooks(owner_user_id);
    ANALYZE public.playbooks;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'whatsapp_conversations'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_clinic_id_fk_cover
      ON public.whatsapp_conversations(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lead_id_fk_cover
      ON public.whatsapp_conversations(lead_id);
    ANALYZE public.whatsapp_conversations;
  END IF;
END $$;
