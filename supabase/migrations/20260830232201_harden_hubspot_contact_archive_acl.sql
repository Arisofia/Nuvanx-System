revoke all on public.hubspot_contact_import_batches from anon, authenticated;
revoke all on public.hubspot_contacts_archive from anon, authenticated;
grant all on public.hubspot_contact_import_batches to service_role;
grant all on public.hubspot_contacts_archive to service_role;
