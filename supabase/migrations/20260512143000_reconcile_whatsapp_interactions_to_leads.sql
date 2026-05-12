-- =============================================================================
-- Reconcile CRM lead stage with recorded WhatsApp interactions
--
-- The CRM pipeline is sourced from public.leads.stage. Historical WhatsApp
-- conversation rows can exist without the lead stage being advanced when the
-- message was imported before webhook matching was available, when the webhook
-- payload did not resolve to a lead immediately, or when only outbound contact was
-- recorded. This function backfills those leads to the WhatsApp stage by matching
-- clinic-scoped WhatsApp conversation phones against normalized lead phones.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reconcile_whatsapp_interactions_to_leads(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  WITH scoped_user AS (
    SELECT u.id AS user_id, u.clinic_id
    FROM public.users u
    WHERE u.id = p_user_id
  ),
  scoped_leads AS (
    SELECT l.id, l.clinic_id, l.phone_normalized
    FROM public.leads l
    JOIN scoped_user su
      ON (
        (su.clinic_id IS NOT NULL AND l.clinic_id = su.clinic_id)
        OR (su.clinic_id IS NULL AND l.user_id = su.user_id)
      )
    WHERE l.deleted_at IS NULL
      AND l.stage = 'lead'
      AND l.phone_normalized IS NOT NULL
      AND l.phone_normalized <> ''
  ),
  whatsapp_matches AS (
    SELECT
      sl.id AS lead_id,
      MIN(wc.sent_at) FILTER (WHERE LOWER(COALESCE(wc.direction, '')) = 'inbound') AS first_inbound_at,
      MIN(wc.sent_at) FILTER (WHERE LOWER(COALESCE(wc.direction, '')) <> 'inbound') AS first_outbound_at,
      MIN(wc.sent_at) AS first_interaction_at
    FROM scoped_leads sl
    JOIN public.whatsapp_conversations wc
      ON (
        wc.lead_id = sl.id
        OR (
          sl.clinic_id IS NOT NULL
          AND wc.clinic_id = sl.clinic_id
          AND wc.phone IS NOT NULL
          AND (
            public.normalize_phone(wc.phone) = sl.phone_normalized
            OR RIGHT(regexp_replace(wc.phone, '[^0-9]', '', 'g'), 9)
             = RIGHT(regexp_replace(sl.phone_normalized, '[^0-9]', '', 'g'), 9)
          )
        )
      )
    GROUP BY sl.id
  ),
  updated AS (
    UPDATE public.leads l
    SET
      stage = 'whatsapp',
      first_inbound_at = COALESCE(l.first_inbound_at, wm.first_inbound_at),
      first_outbound_at = COALESCE(l.first_outbound_at, wm.first_outbound_at, wm.first_interaction_at),
      updated_at = NOW()
    FROM whatsapp_matches wm
    WHERE l.id = wm.lead_id
      AND l.stage = 'lead'
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN COALESCE(updated_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_whatsapp_interactions_to_leads(UUID) TO service_role;
