-- Preserve the browser/CRM NUVANX lineage identifier without overloading
-- applied_lead_id. applied_lead_id is a foreign key to public.leads(id) and
-- must only be populated after an actual Supabase lead has been reconciled.

alter table public.google_click_attributions
  add column if not exists nvx_lead_id uuid;

comment on column public.google_click_attributions.nvx_lead_id is
  'First-party NUVANX browser/CRM lineage UUID. Not the public.leads primary key; applied_lead_id is populated only after reconciliation.';

create index if not exists google_click_attributions_nvx_lead_id_idx
  on public.google_click_attributions (nvx_lead_id)
  where nvx_lead_id is not null;
