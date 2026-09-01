const fs = require('fs');
let code = fs.readFileSync('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', 'utf8');

const oldFunc = `create or replace function public.nvx_wake_whatsapp_outbound_on_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'queued'
     and (tg_op = 'INSERT' or old.state is distinct from 'queued') then
    perform public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 25, null);
  end if;
  return new;
end;
$$;`;

const newFunc = `create or replace function public.nvx_wake_whatsapp_outbound_on_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.whatsapp_outbound_payloads where state = 'queued' limit 1) then
    perform public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 25, null);
  end if;
  return null;
end;
$$;`;

const oldTrig = `create trigger trg_nvx_wake_whatsapp_outbound
after insert or update of state on public.whatsapp_outbound_payloads
for each row execute function public.nvx_wake_whatsapp_outbound_on_queue();`;

const newTrig = `create trigger trg_nvx_wake_whatsapp_outbound
after insert or update of state on public.whatsapp_outbound_payloads
for each statement execute function public.nvx_wake_whatsapp_outbound_on_queue();`;

code = code.replace(oldFunc, newFunc).replace(oldTrig, newTrig);
fs.writeFileSync('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', code);
