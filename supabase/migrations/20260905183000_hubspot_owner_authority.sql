-- Canonical HubSpot owner authority for Meta -> HubSpot -> Deal reconciliation.
--
-- HubSpot contact ownership is the provider authority. Local `leads.assigned_to`
-- is only mirrored when an explicit versioned owner -> user mapping exists.
-- Never infer ownership from names or email addresses.

begin;

create table if not exists public.hubspot_owner_user_mappings (
  hubspot_owner_id text primary key,
  user_id uuid not null references public.users(id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hubspot_owner_user_mappings_owner_id_check
    check (hubspot_owner_id ~ '^[0-9]+$')
);

revoke all on table public.hubspot_owner_user_mappings from public, anon, authenticated;
grant select, insert, update, delete on table public.hubspot_owner_user_mappings to service_role;

-- Production currently has one verified active mapping for the commercial owner
-- used by the canonical Meta contacts. Clean previews may not contain this user,
-- so the seed is intentionally conditional rather than fabricating an identity.
insert into public.hubspot_owner_user_mappings (
  hubspot_owner_id,
  user_id,
  enabled,
  created_at,
  updated_at
)
select
  '33538673',
  u.id,
  true,
  now(),
  now()
from public.users u
where u.id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a'::uuid
on conflict (hubspot_owner_id) do update
set user_id = excluded.user_id,
    enabled = true,
    updated_at = now();

create or replace function public.nvx_apply_hubspot_owner_authority(
  p_lead_id uuid,
  p_hubspot_contact_id bigint,
  p_hubspot_owner_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner_id text := nullif(pg_catalog.btrim(coalesce(p_hubspot_owner_id, '')), '');
  v_user_id uuid;
  v_current_contact_id bigint;
begin
  if p_lead_id is null then
    raise exception 'Lead id is required';
  end if;
  if p_hubspot_contact_id is null or p_hubspot_contact_id <= 0 then
    raise exception 'Valid HubSpot contact id is required';
  end if;
  if v_owner_id is not null and v_owner_id !~ '^[0-9]+$' then
    raise exception 'Invalid HubSpot owner id';
  end if;

  select l.hubspot_contact_id
  into v_current_contact_id
  from public.leads l
  where l.id = p_lead_id
    and l.deleted_at is null
  for update;

  if not found then
    raise exception 'Lead not found';
  end if;
  if v_current_contact_id is not null
     and v_current_contact_id is distinct from p_hubspot_contact_id then
    raise exception 'HubSpot contact authority mismatch';
  end if;

  if v_owner_id is not null then
    select m.user_id
    into v_user_id
    from public.hubspot_owner_user_mappings m
    where m.hubspot_owner_id = v_owner_id
      and m.enabled = true;
  end if;

  update public.leads l
  set hubspot_contact_id = p_hubspot_contact_id,
      assigned_to = case
        when v_owner_id is null then l.assigned_to
        else v_user_id
      end,
      updated_at = case
        when l.hubspot_contact_id is distinct from p_hubspot_contact_id
          or (v_owner_id is not null and l.assigned_to is distinct from v_user_id)
        then now()
        else l.updated_at
      end
  where l.id = p_lead_id;

  insert into public.hubspot_deal_projections (
    lead_id,
    hubspot_contact_id,
    owner_id,
    projection_status,
    updated_at
  )
  values (
    p_lead_id,
    p_hubspot_contact_id,
    v_owner_id,
    'pending',
    now()
  )
  on conflict (lead_id) do update
  set hubspot_contact_id = excluded.hubspot_contact_id,
      owner_id = coalesce(excluded.owner_id, public.hubspot_deal_projections.owner_id),
      projection_status = case
        when public.hubspot_deal_projections.projection_status = 'suppressed' then 'suppressed'
        when excluded.owner_id is not null
          and excluded.owner_id is distinct from public.hubspot_deal_projections.owner_id
          and public.hubspot_deal_projections.projection_status in ('creating', 'updating')
          then public.hubspot_deal_projections.projection_status
        when excluded.owner_id is not null
          and excluded.owner_id is distinct from public.hubspot_deal_projections.owner_id
          then 'pending'
        else public.hubspot_deal_projections.projection_status
      end,
      needs_reprojection = case
        when excluded.owner_id is not null
          and excluded.owner_id is distinct from public.hubspot_deal_projections.owner_id
          and public.hubspot_deal_projections.projection_status in ('creating', 'updating')
          then true
        else public.hubspot_deal_projections.needs_reprojection
      end,
      last_error = case
        when excluded.owner_id is not null
          and excluded.owner_id is distinct from public.hubspot_deal_projections.owner_id
          and public.hubspot_deal_projections.projection_status not in ('creating', 'updating', 'suppressed')
          then null
        else public.hubspot_deal_projections.last_error
      end,
      updated_at = case
        when excluded.owner_id is not null
          and excluded.owner_id is distinct from public.hubspot_deal_projections.owner_id
          then now()
        else public.hubspot_deal_projections.updated_at
      end;

  return v_user_id;
end;
$function$;

revoke all on function public.nvx_apply_hubspot_owner_authority(uuid,bigint,text)
  from public, anon, authenticated;
grant execute on function public.nvx_apply_hubspot_owner_authority(uuid,bigint,text)
  to service_role;

comment on table public.hubspot_owner_user_mappings is
'Explicit provider-owner to local-user authority mapping. Runtime ownership must never be inferred from names or email addresses.';

comment on function public.nvx_apply_hubspot_owner_authority(uuid,bigint,text) is
'Atomically applies HubSpot contact ownership to Deal projection and mirrors assigned_to only through an explicit enabled mapping, preserving active projection claims.';

commit;
