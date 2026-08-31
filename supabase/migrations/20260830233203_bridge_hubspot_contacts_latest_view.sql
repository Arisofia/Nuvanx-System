-- Replay bridge immediately before 20260830233204_preserve_hubspot_creation_timestamp_timezone.
-- Production already has public.vw_hubspot_contacts_latest, while clean Preview history
-- reaches the timezone migration without ever creating it. Keep Production untouched and
-- create the expected pre-migration view only when it is absent.

DO $bridge$
BEGIN
  IF to_regclass('public.vw_hubspot_contacts_latest') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.vw_hubspot_contacts_latest
      WITH (security_invoker = true)
      AS
      SELECT DISTINCT ON (a.hubspot_contact_id)
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
        b.imported_at AS batch_imported_at
      FROM public.hubspot_contacts_archive a
      JOIN public.hubspot_contact_import_batches b ON b.id = a.batch_id
      ORDER BY a.hubspot_contact_id, b.snapshot_date DESC, b.imported_at DESC
    $view$;

    REVOKE ALL ON public.vw_hubspot_contacts_latest FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.vw_hubspot_contacts_latest TO service_role;
  END IF;
END
$bridge$;
