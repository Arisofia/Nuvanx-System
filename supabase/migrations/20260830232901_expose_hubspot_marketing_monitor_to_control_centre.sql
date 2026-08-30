create or replace function public.nvx_get_hubspot_marketing_contact_monitor()
returns table (
  threshold integer,
  last_count integer,
  above_threshold boolean,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
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
    s.updated_at
  from public.hubspot_marketing_contact_monitor_state s
  where s.monitor_key = 'hubspot_marketing_contacts'
  limit 1;
end;
$$;

revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from public;
revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from anon;
grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to authenticated;
grant execute on function public.nvx_get_hubspot_marketing_contact_monitor() to service_role;

comment on function public.nvx_get_hubspot_marketing_contact_monitor() is
  'Authenticated Control Centre read-only projection of the HubSpot marketing-contact threshold monitor. Does not expose archived contact PII.';
