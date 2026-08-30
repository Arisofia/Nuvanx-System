-- Direct patient WhatsApp remains fail-closed until the controlled Meta Test WABA
-- acceptance is completed. Enabling is an explicit per-clinic operational decision.

alter table public.whatsapp_rate_limit_config
  add column if not exists send_enabled boolean not null default false;

create or replace function public.nvx_guard_whatsapp_send_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean := false;
begin
  select c.send_enabled
    into v_enabled
  from public.whatsapp_rate_limit_config c
  where c.clinic_id = new.clinic_id;

  if coalesce(v_enabled, false) is not true then
    raise exception 'whatsapp_direct_disabled' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.nvx_guard_whatsapp_send_insert() from public, anon, authenticated;
grant execute on function public.nvx_guard_whatsapp_send_insert() to service_role;

drop trigger if exists trg_nvx_guard_whatsapp_send_insert on public.whatsapp_send_requests;
create trigger trg_nvx_guard_whatsapp_send_insert
before insert on public.whatsapp_send_requests
for each row
execute function public.nvx_guard_whatsapp_send_insert();
