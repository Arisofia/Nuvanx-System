-- Replay bridge for public.leads before the Control Centre migrations.
-- Clean Preview history has the broad legacy lead shape but misses a small set of
-- canonical CRM fields that Production already has and that later migrations consume.
-- Keep this idempotent: Production already satisfies the contract, so it is a no-op there.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS email_normalized varchar(255),
  ADD COLUMN IF NOT EXISTS name_normalized text,
  ADD COLUMN IF NOT EXISTS doctor_id uuid,
  ADD COLUMN IF NOT EXISTS treatment_type_id uuid;

DO $leads_assignee_fk$
BEGIN
  IF to_regclass('public.users') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint c
       WHERE c.conrelid = 'public.leads'::regclass
         AND c.conname = 'leads_assigned_to_fkey'
     ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_assigned_to_fkey
      FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$leads_assignee_fk$;

CREATE INDEX IF NOT EXISTS idx_leads_assigned_to
  ON public.leads (assigned_to);

CREATE INDEX IF NOT EXISTS idx_leads_doctor_id
  ON public.leads (doctor_id);

CREATE INDEX IF NOT EXISTS idx_leads_treatment_type_id
  ON public.leads (treatment_type_id);
