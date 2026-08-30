begin;

create table if not exists public.control_centre_provider_cache (
  user_id uuid not null,
  provider text not null check (provider in ('meta','google','agenda','crm')),
  cache_key text not null,
  payload jsonb,
  fetched_at timestamptz,
  last_success_at timestamptz,
  expires_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  breaker_state text not null default 'closed' check (breaker_state in ('closed','open','half_open')),
  breaker_open_until timestamptz,
  lease_owner uuid,
  lease_until timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, cache_key)
);

alter table public.control_centre_provider_cache enable row level security;
revoke all on public.control_centre_provider_cache from public, anon, authenticated;
grant select, insert, update, delete on public.control_centre_provider_cache to service_role;

create index if not exists idx_control_centre_provider_cache_expiry
  on public.control_centre_provider_cache (provider, expires_at);
create index if not exists idx_control_centre_provider_cache_breaker
  on public.control_centre_provider_cache (provider, breaker_open_until)
  where breaker_state <> 'closed';

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

  if v_row.breaker_state='open' and v_row.breaker_open_until > v_now then
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

create or replace function public.nvx_control_centre_provider_finish_failure(
  p_user_id uuid,
  p_provider text,
  p_cache_key text,
  p_lease_owner uuid,
  p_error text,
  p_failure_threshold integer default 3,
  p_open_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.control_centre_provider_cache%rowtype;
begin
  if p_failure_threshold < 1 or p_failure_threshold > 10 or p_open_seconds < 30 or p_open_seconds > 3600 then
    raise exception 'invalid breaker configuration';
  end if;

  update public.control_centre_provider_cache
     set failure_count = failure_count + 1,
         breaker_state = case when failure_count + 1 >= p_failure_threshold then 'open' else 'closed' end,
         breaker_open_until = case when failure_count + 1 >= p_failure_threshold then v_now + make_interval(secs => p_open_seconds) else null end,
         lease_owner = null,
         lease_until = null,
         last_error = left(coalesce(p_error,'provider failure'), 500),
         updated_at = v_now
   where user_id=p_user_id and provider=p_provider and cache_key=p_cache_key
     and lease_owner=p_lease_owner
   returning * into v_row;

  if not found then
    return jsonb_build_object('updated', false);
  end if;
  return jsonb_build_object(
    'updated', true,
    'failure_count', v_row.failure_count,
    'breaker_state', v_row.breaker_state,
    'breaker_open_until', v_row.breaker_open_until,
    'payload', v_row.payload,
    'last_success_at', v_row.last_success_at
  );
end;
$$;

revoke all on function public.nvx_control_centre_provider_begin_refresh(uuid,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.nvx_control_centre_provider_finish_success(uuid,text,text,uuid,jsonb,integer) from public, anon, authenticated;
revoke all on function public.nvx_control_centre_provider_finish_failure(uuid,text,text,uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.nvx_control_centre_provider_begin_refresh(uuid,text,text,integer,integer) to service_role;
grant execute on function public.nvx_control_centre_provider_finish_success(uuid,text,text,uuid,jsonb,integer) to service_role;
grant execute on function public.nvx_control_centre_provider_finish_failure(uuid,text,text,uuid,text,integer,integer) to service_role;

create table if not exists public.lead_pipeline_state (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  explicit_stage text check (explicit_stage in ('new_lead','contacted','conversation','valuation_scheduled','valuation_completed','treatment_proposed','treatment_scheduled','treatment_completed','won','lost')),
  next_action text,
  due_at timestamptz,
  lost_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.lead_pipeline_state enable row level security;
revoke all on public.lead_pipeline_state from public, anon, authenticated;
grant select, insert, update, delete on public.lead_pipeline_state to service_role;

create or replace view public.vw_control_centre_pipeline
with (security_invoker = true)
as
with revenue as (
  select lead_id, sum(amount_net) filter (where cancelled_at is null) as settled_revenue,
         max(settled_at) filter (where cancelled_at is null) as last_settled_at
  from public.financial_settlements
  where lead_id is not null
  group by lead_id
), appt as (
  select m.lead_id,
         max(a.appointment_date) as last_appointment_date,
         bool_or(coalesce(a.is_cancelled,false)=false and lower(coalesce(a.status,a.estado,'')) in ('showed','completed','completada','completado','realizada','realizado','atendida','atendido')) as has_completed_appointment,
         bool_or(coalesce(a.is_cancelled,false)=false and a.appointment_date is not null and a.appointment_date >= current_date) as has_scheduled_appointment
  from public.lead_appointment_matches m
  join public.doctoralia_appointments_ingestion a on a.id=m.appointment_ingestion_id
  group by m.lead_id
)
select
  l.id as lead_id,
  l.user_id,
  l.clinic_id,
  l.name,
  l.source,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  coalesce(l.ad_id,l.meta_ad_id) as ad_id,
  coalesce(l.ad_name,l.meta_ad_name) as ad_name,
  l.treatment_name,
  l.assigned_to,
  p.next_action,
  p.due_at,
  coalesce(p.lost_reason, l.lost_reason::text) as lost_reason,
  coalesce(l.verified_revenue,0) + coalesce(r.settled_revenue,0) as verified_revenue,
  coalesce(p.explicit_stage,
    case
      when l.lost_reason is not null or lower(coalesce(l.stage,'')) in ('lost','perdido') then 'lost'
      when coalesce(l.verified_revenue,0) > 0 or coalesce(r.settled_revenue,0) > 0 then 'won'
      when l.attended_at is not null or l.appointment_status::text='showed' or coalesce(a.has_completed_appointment,false) then 'valuation_completed'
      when (l.appointment_date is not null and l.appointment_date >= now()) or (l.appointment_status::text='scheduled' and l.appointment_date is not null) or coalesce(a.has_scheduled_appointment,false) then 'valuation_scheduled'
      when l.first_inbound_at is not null then 'conversation'
      when l.first_outbound_at is not null or l.first_response_at is not null then 'contacted'
      else 'new_lead'
    end
  ) as pipeline_stage,
  case when p.explicit_stage is not null then 'explicit' else 'evidence' end as pipeline_stage_source,
  greatest(l.updated_at, coalesce(p.updated_at,'epoch'::timestamptz), coalesce(r.last_settled_at,'epoch'::timestamptz)) as stage_evidence_at,
  l.created_at,
  l.updated_at
from public.leads l
left join public.lead_pipeline_state p on p.lead_id=l.id
left join revenue r on r.lead_id=l.id
left join appt a on a.lead_id=l.id
where l.deleted_at is null and l.merged_into_lead_id is null;

revoke all on public.vw_control_centre_pipeline from public, anon, authenticated;
grant select on public.vw_control_centre_pipeline to service_role;

create or replace view public.vw_control_centre_lead_timeline
with (security_invoker = true)
as
select e.lead_id,
       'lead_event'::text as source,
       e.event_type as event_type,
       coalesce(e.event_created_at,e.captured_at,e.created_at) as event_at,
       e.channel_label as title,
       e.resolution_status as status,
       jsonb_build_object('source_platform',e.source_platform,'source_channel',e.source_channel,'campaign_id',e.campaign_id,'ad_id',e.ad_id) as metadata
from public.lead_events e
where e.lead_id is not null
union all
select w.lead_id,
       'whatsapp'::text,
       ('whatsapp_' || w.direction)::text,
       w.sent_at,
       case when w.direction='inbound' then 'WhatsApp recibido' else 'WhatsApp enviado' end,
       w.conversation_status::text,
       jsonb_build_object('delivered_at',w.delivered_at,'read_at',w.read_at,'replied_at',w.replied_at,'message_type',w.message_type)
from public.whatsapp_conversations w
where w.lead_id is not null
union all
select m.lead_id,
       'doctoralia'::text,
       'appointment'::text,
       (a.appointment_date::text || ' ' || coalesce(a.appointment_time,'00:00'))::timestamp at time zone 'Europe/Madrid',
       coalesce(a.treatment,a.subject,'Cita Doctoralia'),
       coalesce(a.status,a.estado),
       jsonb_build_object('appointment_id',a.appointment_id,'confirmed',a.confirmed,'clinic',a.clinic,'is_cancelled',a.is_cancelled)
from public.lead_appointment_matches m
join public.doctoralia_appointments_ingestion a on a.id=m.appointment_ingestion_id
where a.appointment_date is not null
union all
select f.lead_id,
       'financial'::text,
       'revenue_settled'::text,
       f.settled_at,
       coalesce(f.template_name,'Ingreso verificado'),
       case when f.cancelled_at is null then 'settled' else 'cancelled' end,
       jsonb_build_object('amount_net',f.amount_net,'source_system',f.source_system,'payment_method',f.payment_method)
from public.financial_settlements f
where f.lead_id is not null;

revoke all on public.vw_control_centre_lead_timeline from public, anon, authenticated;
grant select on public.vw_control_centre_lead_timeline to service_role;

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
    next_action=excluded.next_action,
    due_at=excluded.due_at,
    lost_reason=excluded.lost_reason,
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
revoke all on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) to authenticated, service_role;

commit;
