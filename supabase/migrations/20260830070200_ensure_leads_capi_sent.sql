-- Reconcile the live leads.capi_sent delivery flag into the canonical migration ledger.
-- Production already has this column with DEFAULT false and no NULL rows; this
-- migration makes clean/preview replays match production without rewriting data.

alter table public.leads
  add column if not exists capi_sent boolean default false;

update public.leads
set capi_sent = false
where capi_sent is null;

alter table public.leads
  alter column capi_sent set default false,
  alter column capi_sent set not null;
