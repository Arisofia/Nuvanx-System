drop view public.vw_hubspot_contacts_latest;

alter table public.hubspot_contacts_archive
  alter column hubspot_created_at type timestamptz
  using hubspot_created_at at time zone 'UTC';

create view public.vw_hubspot_contacts_latest
with (security_invoker = true)
as
select distinct on (a.hubspot_contact_id)
  a.batch_id,
  a.hubspot_contact_id,
  a.first_name,
  a.last_name,
  a.email,
  a.email_normalized,
  a.phone,
  a.phone_normalized,
  a.owner_name,
  a.hubspot_lead_status,
  a.hubspot_contact_status,
  a.hubspot_operational_lead_status,
  a.hubspot_sales_followup_status,
  a.associated_form_submission,
  a.hubspot_created_at,
  a.additional_emails,
  a.associated_form_submission_ids,
  a.raw_row,
  a.archived_at,
  b.snapshot_date,
  b.source_filename,
  b.source_sha256,
  b.imported_at as batch_imported_at
from public.hubspot_contacts_archive a
join public.hubspot_contact_import_batches b on b.id = a.batch_id
order by a.hubspot_contact_id, b.snapshot_date desc, b.imported_at desc;

revoke all on public.vw_hubspot_contacts_latest from public;
revoke all on public.vw_hubspot_contacts_latest from anon;
revoke all on public.vw_hubspot_contacts_latest from authenticated;
grant select on public.vw_hubspot_contacts_latest to service_role;

comment on column public.hubspot_contacts_archive.hubspot_created_at is
  'HubSpot contact creation instant. Legacy snapshot values imported without timezone provenance are preserved as UTC wall-clock values; future API snapshots must write timezone-aware timestamps.';
