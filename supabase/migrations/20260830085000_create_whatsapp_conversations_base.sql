-- Canonical base schema required by WhatsApp outbound hardening and Control Centre timeline.
-- Production already has this table; CREATE IF NOT EXISTS makes this a no-op there.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  phone VARCHAR(64) NOT NULL,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('outbound','inbound')),
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  message_preview VARCHAR(255),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  wa_message_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  conversation_status VARCHAR(32) NOT NULL DEFAULT 'sent',
  template_name VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_clinic_id
  ON public.whatsapp_conversations (clinic_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lead_id
  ON public.whatsapp_conversations (lead_id);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.whatsapp_conversations TO service_role;
GRANT ALL ON TABLE public.whatsapp_conversations TO authenticated;

DROP POLICY IF EXISTS wa_conv_service_role ON public.whatsapp_conversations;
CREATE POLICY wa_conv_service_role
  ON public.whatsapp_conversations
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select_clinic
  ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
    AND clinic_id = (select public.current_clinic_id())
  );
