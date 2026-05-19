-- Optimize hot-path reads against public.vw_lead_traceability.
-- The view exposes leads.user_id as lead_user_id and leads.created_at as
-- lead_created_at, and API/reporting queries repeatedly filter by user and
-- page newest leads first.

CREATE INDEX IF NOT EXISTS idx_leads_traceability_user_created_at_desc
  ON public.leads (user_id, created_at DESC)
  WHERE deleted_at IS NULL
    AND (source IS NULL OR lower(btrim(source)) <> 'doctoralia');
