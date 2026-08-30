create table if not exists public.hubspot_contact_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'hubspot' check (source_system = 'hubspot'),
  snapshot_date date not null,
  source_filename text not null,
  source_sha256 text not null unique,
  rows_expected integer not null check (rows_expected >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.hubspot_contacts_archive (
  batch_id uuid not null references public.hubspot_contact_import_batches(id) on delete restrict,
  hubspot_contact_id bigint not null,
  first_name text,
  last_name text,
  email text,
  email_normalized text,
  phone text,
  phone_normalized text,
  owner_name text,
  hubspot_lead_status text,
  hubspot_contact_status text,
  hubspot_operational_lead_status text,
  hubspot_sales_followup_status text,
  associated_form_submission text,
  hubspot_created_at timestamp without time zone,
  additional_emails text,
  associated_form_submission_ids text,
  raw_row jsonb not null default '{}'::jsonb,
  archived_at timestamptz not null default now(),
  primary key (batch_id, hubspot_contact_id)
);

create index if not exists hubspot_contacts_archive_contact_id_idx
  on public.hubspot_contacts_archive (hubspot_contact_id);
create index if not exists hubspot_contacts_archive_email_normalized_idx
  on public.hubspot_contacts_archive (email_normalized)
  where email_normalized is not null;
create index if not exists hubspot_contacts_archive_phone_normalized_idx
  on public.hubspot_contacts_archive (phone_normalized)
  where phone_normalized is not null;
create index if not exists hubspot_contacts_archive_created_at_idx
  on public.hubspot_contacts_archive (hubspot_created_at);

alter table public.hubspot_contact_import_batches enable row level security;
alter table public.hubspot_contacts_archive enable row level security;

revoke all on public.hubspot_contact_import_batches from anon, authenticated;
revoke all on public.hubspot_contacts_archive from anon, authenticated;
grant all on public.hubspot_contact_import_batches to service_role;
grant all on public.hubspot_contacts_archive to service_role;

-- Service-role processes bypass RLS; ordinary clients receive no archive policies.
drop policy if exists hubspot_contact_import_batches_deny_all on public.hubspot_contact_import_batches;
create policy hubspot_contact_import_batches_deny_all
  on public.hubspot_contact_import_batches
  for all to service_role
  using (false)
  with check (false);

drop policy if exists hubspot_contacts_archive_deny_all on public.hubspot_contacts_archive;
create policy hubspot_contacts_archive_deny_all
  on public.hubspot_contacts_archive
  for all to service_role
  using (false)
  with check (false);
