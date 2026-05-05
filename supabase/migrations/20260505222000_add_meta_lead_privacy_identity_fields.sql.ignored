-- Adds new Meta lead fields for privacy, identity, asset tracking and operational quality.
-- These fields improve traceability of paid vs organic traffic and support future campaign-level auditing.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_name        TEXT,
  ADD COLUMN IF NOT EXISTS last_name         TEXT,
  ADD COLUMN IF NOT EXISTS city              TEXT,
  ADD COLUMN IF NOT EXISTS state             TEXT,
  ADD COLUMN IF NOT EXISTS zip_code          TEXT,
  ADD COLUMN IF NOT EXISTS gender            TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_id        TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_name      TEXT,
  ADD COLUMN IF NOT EXISTS meta_form_id      TEXT,
  ADD COLUMN IF NOT EXISTS meta_platform     TEXT,
  ADD COLUMN IF NOT EXISTS is_organic        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at_meta   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS asset_url         TEXT,
  ADD COLUMN IF NOT EXISTS telefono_hash     TEXT,
  ADD COLUMN IF NOT EXISTS email_hash        TEXT,
  ADD COLUMN IF NOT EXISTS raw_field_data    JSONB,
  ADD COLUMN IF NOT EXISTS lead_quality_score INT;

COMMENT ON COLUMN public.leads.meta_ad_id      IS 'Meta ad ID for asset tracking and ad-level attribution';
COMMENT ON COLUMN public.leads.meta_ad_name    IS 'Meta ad name for readable campaign/creative attribution';
COMMENT ON COLUMN public.leads.meta_form_id    IS 'Meta form ID for intent segmentation and form-level attribution';
COMMENT ON COLUMN public.leads.meta_platform   IS 'Meta platform origin, e.g. facebook or instagram';
COMMENT ON COLUMN public.leads.is_organic      IS 'True if the lead was organic, false if paid';
COMMENT ON COLUMN public.leads.created_at_meta IS 'Exact timestamp when Meta recorded the lead submission';
COMMENT ON COLUMN public.leads.asset_url       IS 'Creative asset URL (image or video) associated with the lead';
COMMENT ON COLUMN public.leads.telefono_hash   IS 'SHA-256 hash of the lead telephone for privacy-preserving identity matching';
COMMENT ON COLUMN public.leads.email_hash      IS 'SHA-256 hash of the lead email for privacy-preserving identity matching';
COMMENT ON COLUMN public.leads.raw_field_data  IS 'Raw mapped Meta field_data values for future audit and custom questions';
COMMENT ON COLUMN public.leads.lead_quality_score IS 'Operational lead quality score; can be populated by business rules later';
