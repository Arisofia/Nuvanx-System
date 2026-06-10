-- =============================================================================
-- Migration: Reconcile Source-to-Cash and Populate Event Tables
-- Date: 2026-06-10
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Populate lead_events from leads
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.populate_lead_events_from_leads()
RETURNS void AS $$
BEGIN
    INSERT INTO public.lead_events (
        meta_lead_id,
        source_channel,
        channel_label,
        source_platform,
        event_type,
        full_name,
        email,
        phone,
        normalized_email,
        normalized_phone,
        campaign_id,
        campaign_name,
        adset_id,
        adset_name,
        ad_id,
        ad_name,
        form_id,
        form_name,
        event_created_at,
        resolution_status
    )
    SELECT DISTINCT ON (COALESCE(l.external_id, 'legacy_' || l.id::text))
        COALESCE(l.external_id, 'legacy_' || l.id::text),
        COALESCE(l.source, 'ORGANICO'),
        COALESCE(l.source, 'ORGANICO'),
        CASE 
            WHEN l.source ILIKE '%meta%' OR l.source ILIKE '%facebook%' OR l.source ILIKE '%instagram%' THEN 'meta'
            WHEN l.source ILIKE '%crm%' THEN 'crm'
            ELSE 'web'
        END,
        'meta_lead_form', -- Defaulting to this as it's the primary event type in schema
        l.name_normalized,
        l.email,
        l.phone,
        l.email_normalized,
        l.phone_normalized,
        l.campaign_id,
        l.campaign_name,
        l.adset_id,
        l.adset_name,
        l.ad_id,
        l.ad_name,
        l.form_id,
        l.form_name,
        COALESCE(l.created_at, now()), -- Assuming created_at_meta doesn't exist as per prompt
        'resolved'
    FROM public.leads l
WHERE NOT EXISTS (
    SELECT 1
    FROM public.lead_events existing
    WHERE existing.meta_lead_id = COALESCE(l.external_id, 'legacy_' || l.id::text)
)
ORDER BY COALESCE(l.external_id, 'legacy_' || l.id::text), l.created_at DESC NULLS LAST, l.id;
END;
$$ LANGUAGE plpgsql;

-- Execute population
SELECT public.populate_lead_events_from_leads();

-- -----------------------------------------------------------------------------
-- 2. Reconciliation financial_settlements -> leads
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_settlements_to_leads()
RETURNS void AS $$
DECLARE
    r RECORD;
    v_lead_id uuid;
    v_audit_note text;
BEGIN
    FOR r IN 
        SELECT id, phone_normalized, settled_at, amount_net
        FROM public.financial_settlements
        WHERE lead_id IS NULL OR lead_id IN (SELECT id FROM public.leads LIMIT 0) -- Only 2 were populated as per prompt
    LOOP
        -- Find the closest lead before or at settled_at
        SELECT id INTO v_lead_id
        FROM public.leads
        WHERE phone_normalized = r.phone_normalized
          AND created_at <= r.settled_at
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_lead_id IS NOT NULL THEN
            UPDATE public.financial_settlements
            SET lead_id = v_lead_id,
                audit_note = COALESCE(audit_note, '') || ' Matched to lead via phone_normalized at ' || now()::text
            WHERE id = r.id;
        ELSE
            UPDATE public.financial_settlements
            SET audit_note = COALESCE(audit_note, '') || ' No lead found before settled_at for phone ' || r.phone_normalized
            WHERE id = r.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Execute reconciliation
SELECT public.reconcile_settlements_to_leads();

-- -----------------------------------------------------------------------------
-- 3. Populate patient_classification as a derived table
-- -----------------------------------------------------------------------------
-- Create table if not exists (handling empty state mentioned by user)
CREATE TABLE IF NOT EXISTS public.patient_classification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id uuid REFERENCES public.leads(id),
    phone_normalized text UNIQUE,
    first_seen_at timestamptz,
    first_visit_at timestamptz,
    last_visit_at timestamptz,
    patient_type text,
    funnel_status text,
    total_settled_amount numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Ensure patient_classification is compatible with this migration even if it already existed.
ALTER TABLE public.patient_classification
    ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id),
    ADD COLUMN IF NOT EXISTS phone_normalized text,
    ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
    ADD COLUMN IF NOT EXISTS first_visit_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_visit_at timestamptz,
    ADD COLUMN IF NOT EXISTS patient_type text,
    ADD COLUMN IF NOT EXISTS funnel_status text,
    ADD COLUMN IF NOT EXISTS total_settled_amount numeric DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS patient_classification_phone_normalized_uidx
ON public.patient_classification (phone_normalized)
WHERE phone_normalized IS NOT NULL;
-- Truncate and Repopulate
DELETE FROM public.patient_classification;

INSERT INTO public.patient_classification (
    lead_id,
    phone_normalized,
    first_seen_at,
    first_visit_at,
    last_visit_at,
    patient_type,
    funnel_status,
    total_settled_amount
)
WITH lead_summary AS (
    SELECT 
        phone_normalized,
        (array_agg(id ORDER BY created_at ASC NULLS LAST, id::text ASC))[1] as lead_id,
        MIN(created_at) as first_seen,
        MAX(appointment_date) as last_appointment
    FROM public.leads
    GROUP BY phone_normalized
),
settlement_summary AS (
    SELECT 
        phone_normalized,
        MIN(settled_at) as first_settle,
        MAX(settled_at) as last_settle,
        COUNT(*) as settle_count,
        SUM(amount_net) as total_amount
    FROM public.financial_settlements
    GROUP BY phone_normalized
)
SELECT 
    l.lead_id,
    l.phone_normalized,
    l.first_seen,
    COALESCE(s.first_settle, l.last_appointment) as first_visit_at,
    COALESCE(s.last_settle, l.last_appointment) as last_visit_at,
    CASE 
        WHEN s.settle_count > 1 THEN 'returning'
        WHEN s.settle_count = 1 THEN 'new'
        ELSE 'unconverted'
    END as patient_type,
    CASE 
        WHEN s.settle_count > 1 THEN 'returning'
        WHEN s.settle_count = 1 THEN 'converted'
        WHEN l.last_appointment IS NOT NULL THEN 'scheduled'
        ELSE 'lead'
    END as funnel_status,
    COALESCE(s.total_amount, 0)
FROM lead_summary l
LEFT JOIN settlement_summary s ON l.phone_normalized = s.phone_normalized;

-- -----------------------------------------------------------------------------
-- 4. Validations
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_event_count int;
    v_class_count int;
    v_settle_lead_id_count int;
BEGIN
    SELECT count(*) INTO v_event_count FROM public.lead_events;
    SELECT count(*) INTO v_class_count FROM public.patient_classification;
    SELECT count(*) FROM public.financial_settlements WHERE lead_id IS NOT NULL INTO v_settle_lead_id_count;

    IF v_event_count = 0 THEN
        RAISE EXCEPTION 'Validation failed: lead_events is empty';
    END IF;

    IF v_class_count = 0 THEN
        RAISE EXCEPTION 'Validation failed: patient_classification is empty';
    END IF;

    IF v_settle_lead_id_count <= 2 THEN
        RAISE EXCEPTION 'Validation failed: financial_settlements.lead_id count (%) did not increase significantly', v_settle_lead_id_count;
    END IF;
    
    RAISE NOTICE 'Validation passed: events=%, classification=%, settlements with lead_id=%', 
        v_event_count, v_class_count, v_settle_lead_id_count;
END $$;

COMMIT;


