alter table public.hubspot_marketing_contact_monitor_state
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;

comment on column public.hubspot_marketing_contact_monitor_state.last_error_code is
  'Bounded machine-readable failure code from the canonical HubSpot marketing-contact monitor. Never stores provider payloads or credentials.';

comment on column public.hubspot_marketing_contact_monitor_state.last_error_at is
  'Timestamp of the latest failed canonical HubSpot marketing-contact monitor refresh.';

-- Preserve the authenticated RPC trust boundary introduced by 20260902124732:
-- privileged implementation stays in the non-public schema; the PostgREST-facing
-- public function remains SECURITY INVOKER.
drop function if exists public.nvx_get_hubspot_marketing_contact_monitor();
drop function if exists private.nvx_get_hubspot_marketing_contact_monitor();

create function private.nvx_get_hubspot_marketing_contact_monitor()
returns table (
  threshold integer,
  last_count integer,
  above_threshold boolean,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  age_seconds bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
  ) then
    raise exception 'Control Centre user required' using errcode = '42501';
  end if;

  return query
  select
    s.threshold,
    s.last_count,
    s.above_threshold,
    s.last_checked_at,
    s.last_triggered_at,
    s.last_error_code,
    s.last_error_at,
    case
      when s.last_checked_at is null then null
      else greatest(0, floor(extract(epoch from (now() - s.last_checked_at))))::bigint
    end as age_seconds,
    s.updated_at
  from public.hubspot_marketing_contact_monitor_state s
  where s.monitor_key = 'hubspot_marketing_contacts'
  limit 1;
end;
$$;

revoke all on function private.nvx_get_hubspot_marketing_contact_monitor() from public, anon;
grant execute on function private.nvx_get_hubspot_marketing_contact_monitor() to authenticated, service_role;

create function public.nvx_get_hubspot_marketing_contact_monitor()
returns table (
  threshold integer,
  last_count integer,
  above_threshold boolean,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  age_seconds bigint,
  updated_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.nvx_get_hubspot_marketing_contact_monitor()
$$;

revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from public, anon;
grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to authenticated, service_role;

comment on function public.nvx_get_hubspot_marketing_contact_monitor() is
  'Authenticated SECURITY INVOKER projection of the canonical HubSpot marketing-contact threshold monitor, including freshness and bounded error state without archived contact PII.';
