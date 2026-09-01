import sys

with open('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', 'r') as f:
    code = f.read()

old_func = """-- Extend the existing governed dispatcher with the WhatsApp async worker.
create or replace function public.nvx_dispatch_revops_worker(
  p_worker text,
  p_limit integer default 25,
  p_mode text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_project_url text;
  v_limit integer;
  v_mode text;
  v_body jsonb;
  v_request_id bigint;
begin
  if p_worker not in ('web-lead-reconcile', 'deal-factory', 'google-data-manager-export', 'meta-capi-dispatch', 'whatsapp-outbound-worker') then
    raise exception 'Unsupported RevOps worker';
  end if;"""

new_func = """-- Extract the allowed workers into a configuration function to avoid recreating the full dispatcher body.
create or replace function public.nvx_is_allowed_revops_worker(p_worker text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_worker in (
    'web-lead-reconcile',
    'deal-factory',
    'google-data-manager-export',
    'meta-capi-dispatch',
    'whatsapp-outbound-worker'
  );
$$;

revoke all on function public.nvx_is_allowed_revops_worker(text) from public, anon, authenticated;
grant execute on function public.nvx_is_allowed_revops_worker(text) to service_role;

create or replace function public.nvx_dispatch_revops_worker(
  p_worker text,
  p_limit integer default 25,
  p_mode text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_project_url text;
  v_limit integer;
  v_mode text;
  v_body jsonb;
  v_request_id bigint;
begin
  if not public.nvx_is_allowed_revops_worker(p_worker) then
    raise exception 'Unsupported RevOps worker';
  end if;"""

code = code.replace(old_func, new_func)

with open('supabase/migrations/20260901113000_async_whatsapp_encrypted_outbox.sql', 'w') as f:
    f.write(code)
