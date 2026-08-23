-- Defense-in-depth and FK lookup hardening identified by the 2026-08-23
-- exhaustive repository + live Supabase advisor audit.
--
-- web_lead_captures is intentionally service_role/internal-only: RLS is enabled
-- with no anon/authenticated policies. Revoke inherited table grants as well so
-- the privilege layer and the RLS contract agree.
--
-- The three indexes below cover child-side foreign keys reported by the live
-- Supabase performance advisor. They are deliberately plain btree indexes so
-- deletes/updates of referenced rows do not require child-table scans.

begin;

revoke all privileges on table public.web_lead_captures from anon, authenticated;

create index if not exists google_click_attributions_applied_lead_id_idx
  on public.google_click_attributions (applied_lead_id);

create index if not exists google_data_manager_outbox_attribution_id_idx
  on public.google_data_manager_outbox (attribution_id);

create index if not exists lead_appointment_matches_appointment_ingestion_id_idx
  on public.lead_appointment_matches (appointment_ingestion_id);

commit;
