-- Defense-in-depth for the Meta CAPI outbox: an event cannot enter the durable
-- queue unless its authoritative website lead already has canonical HubSpot
-- identity and the event_id is derived from that exact NUVANX lineage UUID.

create or replace function public.nvx_validate_meta_capi_outbox_lead()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
begin
  select * into v_lead
  from public.leads
  where id = new.lead_id
  for key share;

  if not found or v_lead.deleted_at is not null then
    raise exception 'Meta CAPI outbox requires an active lead';
  end if;
  if v_lead.source <> 'website_hubspot' then
    raise exception 'Meta CAPI outbox accepts only website_hubspot leads';
  end if;
  if v_lead.nvx_lead_id is null then
    raise exception 'Meta CAPI outbox requires NUVANX lineage';
  end if;
  if v_lead.hubspot_contact_id is null or v_lead.hubspot_contact_id <= 0 then
    raise exception 'Meta CAPI outbox requires a canonical HubSpot contact';
  end if;
  if new.event_name <> 'Lead' or new.event_id <> 'lead:' || v_lead.nvx_lead_id::text then
    raise exception 'Meta CAPI outbox event identity mismatch';
  end if;

  return new;
end;
$$;

revoke all on function public.nvx_validate_meta_capi_outbox_lead() from public, anon, authenticated;
grant execute on function public.nvx_validate_meta_capi_outbox_lead() to service_role;

drop trigger if exists trg_meta_capi_outbox_validate_lead on public.meta_capi_outbox;
create trigger trg_meta_capi_outbox_validate_lead
before insert or update of lead_id, event_name, event_id
on public.meta_capi_outbox
for each row execute function public.nvx_validate_meta_capi_outbox_lead();
