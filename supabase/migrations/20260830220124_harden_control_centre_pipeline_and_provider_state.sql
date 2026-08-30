create or replace function public.nvx_control_centre_provider_begin_refresh(
  p_user_id uuid,
  p_provider text,
  p_cache_key text,
  p_ttl_seconds integer default 300,
  p_lease_seconds integer default 45
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.control_centre_provider_cache%rowtype;
  v_owner uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_acquired boolean := false;
begin
  if p_user_id is null or p_provider not in ('meta','google','agenda','crm') or coalesce(btrim(p_cache_key),'') = '' then
    raise exception 'invalid provider cache request';
  end if;
  if p_ttl_seconds < 15 or p_ttl_seconds > 3600 or p_lease_seconds < 5 or p_lease_seconds > 120 then
    raise exception 'invalid provider cache timing';
  end if;

  insert into public.control_centre_provider_cache(user_id, provider, cache_key)
  values (p_user_id, p_provider, p_cache_key)
  on conflict (user_id, provider, cache_key) do nothing;

  select * into v_row
  from public.control_centre_provider_cache
  where user_id=p_user_id and provider=p_provider and cache_key=p_cache_key
  for update;

  if v_row.breaker_state='open' and v_row.breaker_open_until is not null and v_row.breaker_open_until <= v_now then
    update public.control_centre_provider_cache
      set breaker_state='half_open', lease_owner=null, lease_until=null, updated_at=v_now
      where user_id=p_user_id and provider=p_provider and cache_key=p_cache_key;
    v_row.breaker_state := 'half_open';
    v_row.lease_owner := null;
    v_row.lease_until := null;
  end if;

  if v_row.payload is not null and v_row.expires_at is not null and v_row.expires_at > v_now and v_row.breaker_state='closed' then
    return jsonb_build_object(
      'refresh', false,
      'reason', 'fresh_cache',
      'payload', v_row.payload,
      'fetched_at', v_row.fetched_at,
      'last_success_at', v_row.last_success_at,
      'breaker_state', v_row.breaker_state,
      'failure_count', v_row.failure_count
    );
  end if;

  if v_row.breaker_state='open' and (v_row.breaker_open_until is null or v_row.breaker_open_until > v_now) then
    return jsonb_build_object(
      'refresh', false,
      'reason', 'breaker_open',
      'payload', v_row.payload,
      'fetched_at', v_row.fetched_at,
      'last_success_at', v_row.last_success_at,
      'breaker_state', v_row.breaker_state,
      'breaker_open_until', v_row.breaker_open_until,
      'failure_count', v_row.failure_count,
      'last_error', v_row.last_error
    );
  end if;

  -- In half-open we deliberately preserve failure_count. A failed probe must be
  -- able to reopen the breaker immediately instead of requiring a fresh streak.
  if v_row.lease_until is null or v_row.lease_until <= v_now or v_row.lease_owner is null then
    update public.control_centre_provider_cache
      set lease_owner=v_owner,
          lease_until=v_now + make_interval(secs => p_lease_seconds),
          updated_at=v_now
      where user_id=p_user_id and provider=p_provider and cache_key=p_cache_key;
    v_acquired := true;
  end if;

  return jsonb_build_object(
    'refresh', v_acquired,
    'reason', case when v_acquired then 'lease_acquired' else 'refresh_in_flight' end,
    'lease_owner', case when v_acquired then v_owner else null end,
    'payload', v_row.payload,
    'fetched_at', v_row.fetched_at,
    'last_success_at', v_row.last_success_at,
    'breaker_state', v_row.breaker_state,
    'failure_count', v_row.failure_count,
    'last_error', v_row.last_error
  );
end;
$$;

create or replace function public.nvx_control_centre_provider_finish_success(
  p_user_id uuid,
  p_provider text,
  p_cache_key text,
  p_lease_owner uuid,
  p_payload jsonb,
  p_ttl_seconds integer default 300
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_ttl_seconds < 15 or p_ttl_seconds > 3600 then
    raise exception 'invalid provider cache timing';
  end if;

  update public.control_centre_provider_cache
     set payload = p_payload,
         fetched_at = v_now,
         last_success_at = v_now,
         expires_at = v_now + make_interval(secs => p_ttl_seconds),
         failure_count = 0,
         breaker_state = 'closed',
         breaker_open_until = null,
         lease_owner = null,
         lease_until = null,
         last_error = null,
         updated_at = v_now
   where user_id=p_user_id and provider=p_provider and cache_key=p_cache_key
     and lease_owner=p_lease_owner;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.nvx_set_lead_pipeline_state(
  p_lead_id uuid,
  p_stage text default null,
  p_next_action text default null,
  p_due_at timestamptz default null,
  p_lost_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_current text;
  v_old_rank int;
  v_new_rank int;
  v_allowed text[] := array['new_lead','contacted','conversation','valuation_scheduled','valuation_completed','treatment_proposed','treatment_scheduled','treatment_completed','won','lost'];
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if not exists(select 1 from public.leads where id=p_lead_id and user_id=v_user and deleted_at is null) then
    raise exception 'lead not found';
  end if;
  select pipeline_stage into v_current from public.vw_control_centre_pipeline where lead_id=p_lead_id;

  if p_stage is not null then
    if not (p_stage = any(v_allowed)) then raise exception 'invalid pipeline stage'; end if;
    if v_current in ('won','lost') and p_stage <> v_current then raise exception 'terminal pipeline stage cannot be reopened'; end if;
    v_old_rank := array_position(v_allowed,v_current);
    v_new_rank := array_position(v_allowed,p_stage);
    if p_stage <> 'lost' and v_old_rank is not null and v_new_rank < v_old_rank then
      raise exception 'pipeline stage cannot move backwards';
    end if;
  end if;

  insert into public.lead_pipeline_state(lead_id,explicit_stage,next_action,due_at,lost_reason,updated_by,updated_at)
  values (p_lead_id,p_stage,p_next_action,p_due_at,p_lost_reason,v_user,now())
  on conflict (lead_id) do update set
    explicit_stage=coalesce(excluded.explicit_stage,public.lead_pipeline_state.explicit_stage),
    next_action=coalesce(excluded.next_action,public.lead_pipeline_state.next_action),
    due_at=coalesce(excluded.due_at,public.lead_pipeline_state.due_at),
    lost_reason=coalesce(excluded.lost_reason,public.lead_pipeline_state.lost_reason),
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;

  if p_stage is not null and p_stage is distinct from v_current then
    insert into public.lead_events(
      lead_id,source_platform,source_channel,channel_label,event_type,event_created_at,captured_at,resolution_status,raw_payload,created_at,updated_at
    ) values (
      p_lead_id,'nuvanx','control_centre','Control Centre','pipeline_stage_changed',now(),now(),'resolved',
      jsonb_build_object('previous_stage',v_current,'new_stage',p_stage,'actor_user_id',v_user),now(),now()
    );
  end if;

  return (select to_jsonb(v) from public.vw_control_centre_pipeline v where v.lead_id=p_lead_id);
end;
$$;

revoke all on function public.nvx_control_centre_provider_begin_refresh(uuid,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.nvx_control_centre_provider_begin_refresh(uuid,text,text,integer,integer) to service_role;
revoke all on function public.nvx_control_centre_provider_finish_success(uuid,text,text,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.nvx_control_centre_provider_finish_success(uuid,text,text,uuid,jsonb,integer) to service_role;
revoke all on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) to authenticated, service_role;
