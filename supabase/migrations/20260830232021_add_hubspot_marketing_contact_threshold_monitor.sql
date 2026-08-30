alter table public.hubspot_contacts_archive
  add column if not exists marketing_contact boolean,
  add column if not exists marketing_reason_type text,
  add column if not exists marketing_until_renewal boolean;

create table if not exists public.hubspot_marketing_contact_monitor_state (
  monitor_key text primary key,
  threshold integer not null check (threshold > 0),
  last_count integer,
  above_threshold boolean not null default false,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
  last_snapshot_batch_id uuid references public.hubspot_contact_import_batches(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.hubspot_marketing_contact_monitor_state enable row level security;
revoke all on public.hubspot_marketing_contact_monitor_state from anon, authenticated;
grant all on public.hubspot_marketing_contact_monitor_state to service_role;

insert into public.hubspot_marketing_contact_monitor_state (
  monitor_key,
  threshold,
  last_count,
  above_threshold
)
values ('hubspot_marketing_contacts', 900, 413, false)
on conflict (monitor_key) do update
set threshold = excluded.threshold,
    last_count = coalesce(public.hubspot_marketing_contact_monitor_state.last_count, excluded.last_count),
    updated_at = now();
