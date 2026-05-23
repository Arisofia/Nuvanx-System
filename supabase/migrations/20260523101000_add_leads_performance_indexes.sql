-- Add performance indexes for leads - 23 May 2026

-- Add indexes for commonly queried fields to improve performance
CREATE INDEX IF NOT EXISTS idx_leads_phone_normalized ON public.leads (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads (email);
CREATE INDEX IF NOT EXISTS idx_leads_external_id ON public.leads (external_id);
CREATE INDEX IF NOT EXISTS idx_leads_clinic_id ON public.leads (clinic_id);
