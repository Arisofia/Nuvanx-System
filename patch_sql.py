import sys

with open('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', 'r') as f:
    code = f.read()

code = code.replace(
"""  if v_decision = 'reserved' and v_request_id is not null then
    insert into public.whatsapp_outbound_payloads (
      request_id,
      ciphertext,
      iv,
      key_version,
      state,
      expires_at,
      created_at,
      updated_at
    ) values (
      v_request_id,
      p_ciphertext,
      p_iv,
      p_key_version,
      'queued',
      pg_catalog.clock_timestamp() + interval '1 hour',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    );
  end if;""",
"""  if (v_decision = 'reserved' or (v_decision = 'duplicate' and v_request_status = 'reserved')) and v_request_id is not null then
    insert into public.whatsapp_outbound_payloads (
      request_id,
      ciphertext,
      iv,
      key_version,
      state,
      expires_at,
      created_at,
      updated_at
    ) values (
      v_request_id,
      p_ciphertext,
      p_iv,
      p_key_version,
      'queued',
      pg_catalog.clock_timestamp() + interval '1 hour',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    ) on conflict (request_id) do nothing;
  end if;""")

code = code.replace(
"""create or replace function public.nvx_wake_whatsapp_outbound_on_queue()
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
$$;""",
"""create or replace function public.nvx_wake_whatsapp_outbound_on_queue()
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
$$;""")

code = code.replace(
"""create trigger trg_nvx_wake_whatsapp_outbound
after insert or update of state on public.whatsapp_outbound_payloads
for each row execute function public.nvx_wake_whatsapp_outbound_on_queue();""",
"""create trigger trg_nvx_wake_whatsapp_outbound
after insert or update of state on public.whatsapp_outbound_payloads
for each statement execute function public.nvx_wake_whatsapp_outbound_on_queue();""")

with open('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', 'w') as f:
    f.write(code)
