alter table public.hubspot_marketing_contact_monitor_state
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz;

comment on column public.hubspot_marketing_contact_monitor_state.last_error_code is
  'Bounded machine-readable failure code from the canonical HubSpot marketing-contact monitor. Never stores provider payloads or credentials.';

comment on column public.hubspot_marketing_contact_monitor_state.last_error_at is
  'Timestamp of the latest failed canonical HubSpot marketing-contact monitor refresh.';

-- Preserve the authenticated RPC trust boundary introduced by 20260902124732:
-- privileged implementations stay in the non-public schema; PostgREST-facing
-- public functions remain SECURITY INVOKER.
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

-- Commit a successful provider observation under a row lock so concurrent
-- scheduled/manual invocations cannot both emit the same below->above event.
drop function if exists public.nvx_commit_hubspot_marketing_contact_monitor(integer);
drop function if exists private.nvx_commit_hubspot_marketing_contact_monitor(integer);

create function private.nvx_commit_hubspot_marketing_contact_monitor(p_count integer)
returns table (
  threshold integer,
  above_threshold boolean,
  threshold_transition boolean,
  checked_at timestamptz,
  last_triggered_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold integer;
  v_was_above boolean;
  v_transition boolean;
  v_checked_at timestamptz;
  v_last_triggered_at timestamptz;
begin
  if p_count is null or p_count < 0 then
    raise exception 'Invalid HubSpot marketing contact count' using errcode = '22023';
  end if;

  select s.threshold, s.above_threshold, s.last_triggered_at
    into v_threshold, v_was_above, v_last_triggered_at
  from public.hubspot_marketing_contact_monitor_state s
  where s.monitor_key = 'hubspot_marketing_contacts'
  for update;

  if not found then
    raise exception 'HubSpot marketing contact monitor state unavailable' using errcode = 'P0002';
  end if;

  if v_threshold is null or v_threshold <= 0 or v_was_above is null then
    raise exception 'HubSpot marketing contact monitor state invalid' using errcode = '22023';
  end if;

  v_transition := p_count >= v_threshold and not v_was_above;
  v_checked_at := clock_timestamp();

  update public.hubspot_marketing_contact_monitor_state s
  set
    last_count = p_count,
    above_threshold = p_count >= v_threshold,
    last_checked_at = v_checked_at,
    last_triggered_at = case when v_transition then v_checked_at else s.last_triggered_at end,
    last_error_code = null,
    last_error_at = null,
    updated_at = v_checked_at
  where s.monitor_key = 'hubspot_marketing_contacts'
  returning s.last_triggered_at into v_last_triggered_at;

  return query
  select
    v_threshold,
    p_count >= v_threshold,
    v_transition,
    v_checked_at,
    v_last_triggered_at;
end;
$$;

revoke all on function private.nvx_commit_hubspot_marketing_contact_monitor(integer) from public, anon, authenticated;
grant execute on function private.nvx_commit_hubspot_marketing_contact_monitor(integer) to service_role;

create function public.nvx_commit_hubspot_marketing_contact_monitor(p_count integer)
returns table (
  threshold integer,
  above_threshold boolean,
  threshold_transition boolean,
  checked_at timestamptz,
  last_triggered_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.nvx_commit_hubspot_marketing_contact_monitor(p_count)
$$;

revoke all on function public.nvx_commit_hubspot_marketing_contact_monitor(integer) from public, anon, authenticated;
grant execute on function public.nvx_commit_hubspot_marketing_contact_monitor(integer) to service_role;

comment on function public.nvx_commit_hubspot_marketing_contact_monitor(integer) is
  'Service-role-only SECURITY INVOKER wrapper that atomically commits a validated HubSpot marketing-contact count and emits a threshold transition exactly once.';
