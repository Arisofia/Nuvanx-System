-- Replay bridge for public.financial_settlements before the Control Centre timeline.
-- The clean Preview history carries a reduced legacy settlement shape. Production
-- already has these canonical enrichment columns. Add only the missing contract so
-- later reporting migrations can compile without deleting legacy compatibility fields.

ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS amount_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method varchar(64),
  ADD COLUMN IF NOT EXISTS upload_id uuid,
  ADD COLUMN IF NOT EXISTS intermediary_id varchar(32),
  ADD COLUMN IF NOT EXISTS dni_hash varchar(64),
  ADD COLUMN IF NOT EXISTS intermediary_name varchar(255),
  ADD COLUMN IF NOT EXISTS status_original varchar(128),
  ADD COLUMN IF NOT EXISTS status_type varchar(32),
  ADD COLUMN IF NOT EXISTS room_id varchar(64),
  ADD COLUMN IF NOT EXISTS lead_source varchar(128),
  ADD COLUMN IF NOT EXISTS agenda_name varchar(128),
  ADD COLUMN IF NOT EXISTS template_phone varchar(16),
  ADD COLUMN IF NOT EXISTS template_patient_name text;

CREATE INDEX IF NOT EXISTS settlements_template_phone_idx
  ON public.financial_settlements (template_phone)
  WHERE template_phone IS NOT NULL;
