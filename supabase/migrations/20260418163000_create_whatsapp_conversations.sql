-- =============================================================================
-- Create whatsapp_conversations table
-- Stores outbound/inbound WhatsApp messages scoped to clinic + lead.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             UUID          NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id               UUID          REFERENCES public.leads(id) ON DELETE SET NULL,
  phone                 VARCHAR(32)   NOT NULL,
  direction             VARCHAR(16)   NOT NULL DEFAULT 'outbound',
  message_type          VARCHAR(32)   NOT NULL DEFAULT 'text',
  message_preview       VARCHAR(255),
  sent_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  wa_message_id         VARCHAR(128),
  -- columns pre-included so subsequent ALTER TABLE … ADD COLUMN IF NOT EXISTS are no-ops
  conversation_status   VARCHAR(32)   NOT NULL DEFAULT 'sent',
  template_name         VARCHAR(255),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_clinic_id_fk_cover ON public.whatsapp_conversations(clinic_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lead_id_fk_cover   ON public.whatsapp_conversations(lead_id);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
