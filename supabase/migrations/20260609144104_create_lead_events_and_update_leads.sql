-- =============================================================================
-- Migración: Crear tabla lead_events y actualizar tabla leads para atribución
-- Fecha: 2026-06-09
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Crear tabla `public.lead_events`
--    Esta tabla será la fuente de verdad para los eventos de leads,
--    especialmente de Meta Lead Forms.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_lead_id text UNIQUE NOT NULL, -- ID único de Meta Lead Form
    source_channel text NOT NULL,       -- Ej: 'RRSS', 'ORGANICO'
    channel_label text NOT NULL,        -- Ej: 'RRSS', 'ORGANICO'
    source_platform text NOT NULL,      -- Ej: 'meta', 'doctoralia', 'web'
    event_type text NOT NULL,           -- Ej: 'meta_lead_form', 'doctoralia_appointment'
    attribution_locked boolean DEFAULT FALSE, -- Si la atribución es definitiva
    full_name text,
    first_name text,
    last_name text,
    email text,
    phone text,
    normalized_email text,
    normalized_phone text,
    form_id text,
    form_name text,
    ad_id text,
    ad_name text,
    adset_id text,
    adset_name text,
    campaign_id text,
    campaign_name text,
    event_created_at timestamptz NOT NULL, -- created_time de Meta
    captured_at timestamptz NOT NULL DEFAULT now(), -- Cuando el webhook lo recibió
    raw_payload jsonb,                  -- Payload completo de Meta API o webhook
    resolution_status text DEFAULT 'resolved', -- 'resolved', 'pending_meta_resolution', 'historical_unresolved'
    error_message text,
    treatment_interest text,
    location_preference text,
    raw_form_answers jsonb,             -- field_data de Meta
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_events IS 'Registro de eventos de leads con atribución detallada.';
COMMENT ON COLUMN public.lead_events.meta_lead_id IS 'Identificador único del lead en Meta.';
COMMENT ON COLUMN public.lead_events.source_channel IS 'Canal principal de origen (ej. RRSS, ORGANICO).';
COMMENT ON COLUMN public.lead_events.channel_label IS 'Etiqueta del canal para display.';
COMMENT ON COLUMN public.lead_events.source_platform IS 'Plataforma específica de origen (ej. meta, doctoralia).';
COMMENT ON COLUMN public.lead_events.event_type IS 'Tipo de evento de lead (ej. meta_lead_form).';
COMMENT ON COLUMN public.lead_events.attribution_locked IS 'Indica si la atribución de este evento está finalizada.';
COMMENT ON COLUMN public.lead_events.event_created_at IS 'Timestamp de creación del lead en la plataforma de origen.';
COMMENT ON COLUMN public.lead_events.captured_at IS 'Timestamp de recepción del evento en Supabase.';
COMMENT ON COLUMN public.lead_events.raw_payload IS 'Payload JSON completo recibido del webhook o de la API de origen.';
COMMENT ON COLUMN public.lead_events.resolution_status IS 'Estado de la resolución de datos del lead (ej. resolved, pending_meta_resolution).';
COMMENT ON COLUMN public.lead_events.raw_form_answers IS 'Datos de los campos del formulario de Meta.';


-- Índices para `lead_events`
CREATE INDEX IF NOT EXISTS idx_lead_events_meta_lead_id ON public.lead_events (meta_lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_normalized_email ON public.lead_events (normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_events_normalized_phone ON public.lead_events (normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_events_campaign_id ON public.lead_events (campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_ad_id ON public.lead_events (ad_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_form_id ON public.lead_events (form_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_event_created_at ON public.lead_events (event_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_events_source_channel ON public.lead_events (source_channel);
CREATE INDEX IF NOT EXISTS idx_lead_events_resolution_status ON public.lead_events (resolution_status);


-- Trigger para `updated_at` en `lead_events`
DROP TRIGGER IF EXISTS trg_lead_events_updated_at ON public.lead_events;
CREATE TRIGGER trg_lead_events_updated_at
  BEFORE UPDATE ON public.lead_events
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- -----------------------------------------------------------------------------
-- 2. Actualizar tabla `public.leads`
--    Añadir columnas para mejor atribución y compatibilidad con `lead_events`.
-- -----------------------------------------------------------------------------
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS normalized_email text,
ADD COLUMN IF NOT EXISTS normalized_phone text,
ADD COLUMN IF NOT EXISTS meta_lead_id text,
ADD COLUMN IF NOT EXISTS meta_form_name text,
ADD COLUMN IF NOT EXISTS meta_ad_name text,
ADD COLUMN IF NOT EXISTS meta_campaign_name text,
ADD COLUMN IF NOT EXISTS meta_adset_id text,
ADD COLUMN IF NOT EXISTS meta_adset_name text;

COMMENT ON COLUMN public.leads.normalized_email IS 'Email normalizado para deduplicación.';
COMMENT ON COLUMN public.leads.normalized_phone IS 'Teléfono normalizado para deduplicación.';
COMMENT ON COLUMN public.leads.meta_lead_id IS 'ID del lead en Meta (si aplica).';
COMMENT ON COLUMN public.leads.meta_form_name IS 'Nombre del formulario de Meta.';
COMMENT ON COLUMN public.leads.meta_ad_name IS 'Nombre del anuncio de Meta.';
COMMENT ON COLUMN public.leads.meta_campaign_name IS 'Nombre de la campaña de Meta.';
COMMENT ON COLUMN public.leads.meta_adset_id IS 'ID del adset de Meta.';
COMMENT ON COLUMN public.leads.meta_adset_name IS 'Nombre del adset de Meta.';

-- Añadir índices a las nuevas columnas de `leads`
CREATE INDEX IF NOT EXISTS idx_leads_normalized_email ON public.leads (normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_normalized_phone ON public.leads (normalized_phone) WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_meta_lead_id ON public.leads (meta_lead_id) WHERE meta_lead_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. Eliminar la tabla `meta_attribution` si ya no es necesaria
--    La nueva tabla `lead_events` la reemplaza como fuente de verdad.
--    Si hay dependencias, esta parte puede comentarse o manejarse aparte.
--    El prompt dice "Upsert into meta_attribution (this will be replaced/augmented by lead_events)".
--    Por ahora, la mantendremos para evitar romper dependencias, pero la lógica
--    de llenado se ha movido a `lead_events`.
-- -----------------------------------------------------------------------------
-- DROP TABLE IF EXISTS public.meta_attribution;
COMMIT;