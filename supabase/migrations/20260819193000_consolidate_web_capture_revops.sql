-- Consolidate web capture -> lead -> Deal/Google reconciliation around web_lead_captures.
-- Google attribution is optional; a successful HubSpot web capture can become an
-- operational lead even when no Google click record exists.
--
-- IMPORTANT: this base migration intentionally creates no outbound pg_net route
-- and no cron job. Environment-specific routing is installed by the following
-- migration only after a runtime project URL can be provisioned into Vault.

alter table public.web_lead_captures
  add column if not exists reconciliation_status text not null default 'pending',
  add column if not exists reconciliation_error text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists last_reconciliation_attempt_at timestamptz;

alter table public.web_lead_captures
  drop constraint if exists web_lead_captures_reconciliation_status_check;
alter table public.web_lead_captures
  add constraint web_lead_captures_reconciliation_status_check
  check (reconciliation_status in ('pending','failed','qa_suppressed','reconciled','conflict'));

create index if not exists web_lead_captures_pending_reconcile_idx
  on public.web_lead_captures (captured_at, nvx_lead_id)
  where applied_lead_id is null and reconciliation_status in ('pending','failed');

-- Runtime secrets are restricted to server-only RevOps workers. The HubSpot
-- credential is bootstrapped from WordPress after HubSpot validates its hub/scopes.
create or replace function public.nvx_set_runtime_secret(p_name text, p_value text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name not in ('HUBSPOT_ACCESS_TOKEN') then
    raise exception 'Unsupported runtime secret';
  end if;
  if p_value is null or length(p_value) < 20 or length(p_value) > 4096 then
    raise exception 'Invalid runtime secret';
  end if;

  select id into v_id from vault.secrets where name = p_name limit 1;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'NUVANX server-only runtime credential', null);
  else
    perform vault.update_secret(v_id, p_value, p_name, 'NUVANX server-only runtime credential', null);
  end if;
  return true;
end;
$$;

-- One least-privilege internal dispatch secret is generated entirely inside
-- Supabase. It never leaves Vault except to authenticated server workers/pg_net.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'REVOPS_INTERNAL_SECRET') then
    perform vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
      'REVOPS_INTERNAL_SECRET',
      'NUVANX internal RevOps worker dispatch credential',
      null
    );
  end if;
end;
$$;

create or replace function public.nvx_get_runtime_secret(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_name not in ('HUBSPOT_ACCESS_TOKEN','REVOPS_INTERNAL_SECRET') then
    raise exception 'Unsupported runtime secret';
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = p_name
  limit 1;
  return v_secret;
end;
$$;

revoke all on function public.nvx_set_runtime_secret(text,text) from public, anon, authenticated;
revoke all on function public.nvx_get_runtime_secret(text) from public, anon, authenticated;
grant execute on function public.nvx_set_runtime_secret(text,text) to service_role;
grant execute on function public.nvx_get_runtime_secret(text) to service_role;

-- Atomic finalizer for a canonical successful web capture. It always queues the
-- HubSpot Deal projection for a real lead. Google feedback is queued only when a
-- matching non-QA Google attribution exists for the same nvx_lead_id.
create or replace function public.finalize_web_capture_reconciliation(
  p_capture_id uuid,
  p_lead_id uuid,
  p_hubspot_contact_id bigint,
  p_owner_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture public.web_lead_captures%rowtype;
  v_lead public.leads%rowtype;
  v_google_count integer := 0;
begin
  select * into v_capture
  from public.web_lead_captures
  where id = p_capture_id
  for update;
  if not found then raise exception 'Capture not found'; end if;
  if v_capture.is_test_lead then raise exception 'QA capture cannot be reconciled'; end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id and deleted_at is null
  for update;
  if not found then raise exception 'Lead not found'; end if;
  if v_lead.source <> 'website_hubspot' then raise exception 'Unexpected lead source'; end if;
  if v_lead.nvx_lead_id is distinct from v_capture.nvx_lead_id then raise exception 'Lead lineage mismatch'; end if;
  if v_lead.hubspot_contact_id is distinct from p_hubspot_contact_id then raise exception 'HubSpot contact mismatch'; end if;
  if v_capture.applied_lead_id is not null and v_capture.applied_lead_id <> p_lead_id then
    raise exception 'Capture already applied to another lead';
  end if;

  if exists (
    select 1
    from public.google_click_attributions g
    where g.nvx_lead_id = v_capture.nvx_lead_id
      and g.applied_lead_id is not null
      and g.applied_lead_id <> p_lead_id
  ) then
    raise exception 'Google attribution lineage conflict';
  end if;

  update public.web_lead_captures
  set applied_lead_id = p_lead_id,
      applied_at = coalesce(applied_at, now()),
      reconciliation_status = 'reconciled',
      reconciliation_error = null,
      reconciled_at = coalesce(reconciled_at, now()),
      last_reconciliation_attempt_at = now(),
      last_seen_at = now()
  where id = p_capture_id;

  update public.google_click_attributions
  set applied_lead_id = p_lead_id,
      applied_at = coalesce(applied_at, now()),
      reconciliation_status = 'reconciled',
      reconciliation_error = null,
      last_reconciliation_attempt_at = now()
  where nvx_lead_id = v_capture.nvx_lead_id
    and coalesce(is_test_lead, false) = false
    and (applied_lead_id is null or applied_lead_id = p_lead_id);
  get diagnostics v_google_count = row_count;

  insert into public.hubspot_deal_projections (
    lead_id, hubspot_contact_id, owner_id, projection_status, updated_at
  ) values (
    p_lead_id, p_hubspot_contact_id, nullif(trim(p_owner_id), ''), 'pending', now()
  )
  on conflict (lead_id) do update
  set hubspot_contact_id = excluded.hubspot_contact_id,
      owner_id = coalesce(excluded.owner_id, public.hubspot_deal_projections.owner_id),
      projection_status = case
        when public.hubspot_deal_projections.projection_status = 'suppressed' then 'suppressed'
        else 'pending'
      end,
      last_error = null,
      updated_at = now();

  if v_google_count > 0 then
    perform public.queue_google_data_manager_event(
      p_lead_id,
      'lead',
      coalesce(v_capture.captured_at, now()),
      null,
      'lead:' || p_lead_id::text
    );
  end if;

  return p_lead_id;
end;
$$;

revoke all on function public.finalize_web_capture_reconciliation(uuid,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.finalize_web_capture_reconciliation(uuid,uuid,bigint,text) to service_role;
