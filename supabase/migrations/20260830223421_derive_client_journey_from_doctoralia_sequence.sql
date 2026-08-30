alter table public.lead_pipeline_state
  drop constraint if exists lead_pipeline_state_explicit_stage_check;

alter table public.lead_pipeline_state
  add constraint lead_pipeline_state_explicit_stage_check
  check (explicit_stage in (
    'new_lead','contacted','conversation','valuation_scheduled','valuation_completed',
    'treatment_proposed','treatment_scheduled','treatment_completed',
    'control_scheduled','client_completed','won','lost'
  ));

create or replace view public.vw_control_centre_pipeline
with (security_invoker = true)
as
with revenue as (
  select
    lead_id,
    sum(amount_net) filter (where cancelled_at is null) as settled_revenue,
    max(settled_at) filter (where cancelled_at is null) as last_settled_at
  from public.financial_settlements
  where lead_id is not null
  group by lead_id
),
primary_anchor as (
  select distinct on (m.lead_id)
    m.lead_id,
    nullif(a.doctoralia_id,'') as doctoralia_id,
    nullif(a.phone_normalized,'') as phone_normalized,
    m.matched_at
  from public.lead_appointment_matches m
  join public.doctoralia_appointments_ingestion a
    on a.id=m.appointment_ingestion_id
  where m.is_primary is true
  order by m.lead_id, m.matched_at desc, m.appointment_ingestion_id
),
journey_candidates as (
  select
    l.id as lead_id,
    a.id as appointment_ingestion_id,
    coalesce(nullif(a.appointment_id,''), nullif(a.source_key,''), a.id::text) as appointment_key,
    a.appointment_date,
    a.appointment_time,
    a.imported_at,
    a.updated_at
  from public.leads l
  join primary_anchor x on x.lead_id=l.id
  join public.doctoralia_appointments_ingestion a
    on (
      (x.doctoralia_id is not null and a.doctoralia_id=x.doctoralia_id)
      or (
        x.doctoralia_id is null
        and x.phone_normalized is not null
        and a.phone_normalized=x.phone_normalized
      )
    )
  where l.deleted_at is null
    and l.merged_into_lead_id is null
    and a.appointment_date is not null
    and a.appointment_date >= l.created_at::date
    and coalesce(a.is_cancelled,false)=false
    and lower(coalesce(a.status,a.estado,'')) not in (
      'anulada','anulado','cancelada','cancelado','no acude','no_show','no show'
    )
),
journey_dedup as (
  select distinct on (lead_id, appointment_key)
    lead_id,
    appointment_ingestion_id,
    appointment_key,
    appointment_date,
    appointment_time,
    imported_at,
    updated_at
  from journey_candidates
  order by
    lead_id,
    appointment_key,
    imported_at desc nulls last,
    updated_at desc nulls last,
    appointment_ingestion_id
),
journey_ranked as (
  select
    d.*,
    row_number() over (
      partition by d.lead_id
      order by d.appointment_date, coalesce(d.appointment_time,''), d.appointment_ingestion_id
    ) as visit_number
  from journey_dedup d
),
journey as (
  select
    lead_id,
    count(*)::bigint as journey_appointment_count,
    max(appointment_date) filter (where visit_number=1) as valuation_appointment_date,
    max(appointment_date) filter (where visit_number=2) as treatment_appointment_date,
    max(appointment_date) filter (where visit_number=3) as first_control_appointment_date,
    max(appointment_date) as last_journey_appointment_date
  from journey_ranked
  group by lead_id
),
stage_candidates as (
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
    coalesce(p.lost_reason,l.lost_reason::text) as lost_reason,
    coalesce(r.settled_revenue,0) as verified_revenue,
    case when p.explicit_stage='won' then 'client_completed' else p.explicit_stage end as explicit_stage_normalized,
    case
      when l.lost_reason is not null or lower(coalesce(l.stage,'')) in ('lost','perdido') then 'lost'
      when j.first_control_appointment_date is not null
           and j.treatment_appointment_date is not null
           and j.treatment_appointment_date <= current_date
           and j.first_control_appointment_date <= current_date then 'client_completed'
      when j.first_control_appointment_date is not null
           and j.treatment_appointment_date is not null
           and j.treatment_appointment_date <= current_date then 'control_scheduled'
      when j.treatment_appointment_date is not null
           and j.treatment_appointment_date <= current_date then 'treatment_completed'
      when j.treatment_appointment_date is not null then 'treatment_scheduled'
      when j.valuation_appointment_date is not null
           and j.valuation_appointment_date <= current_date then 'valuation_completed'
      when j.valuation_appointment_date is not null then 'valuation_scheduled'
      when l.first_inbound_at is not null then 'conversation'
      when l.first_outbound_at is not null or l.first_response_at is not null then 'contacted'
      else 'new_lead'
    end as evidence_stage,
    l.updated_at,
    p.updated_at as pipeline_updated_at,
    r.last_settled_at,
    x.matched_at as appointment_matched_at,
    coalesce(j.journey_appointment_count,0)::bigint as journey_appointment_count,
    j.valuation_appointment_date,
    j.treatment_appointment_date,
    j.first_control_appointment_date,
    (
      j.first_control_appointment_date is not null
      and j.treatment_appointment_date is not null
      and j.treatment_appointment_date <= current_date
    ) as is_new_client,
    case
      when j.first_control_appointment_date is not null
           and j.treatment_appointment_date is not null
           and j.treatment_appointment_date <= current_date
           and j.first_control_appointment_date <= current_date
      then j.first_control_appointment_date
      else null::date
    end as client_completed_at,
    case
      when x.doctoralia_id is not null then 'doctoralia_id'
      when x.phone_normalized is not null then 'phone_normalized'
      else null::text
    end as journey_identity_source,
    j.last_journey_appointment_date,
    l.created_at
  from public.leads l
  left join public.lead_pipeline_state p on p.lead_id=l.id
  left join revenue r on r.lead_id=l.id
  left join primary_anchor x on x.lead_id=l.id
  left join journey j on j.lead_id=l.id
  where l.deleted_at is null and l.merged_into_lead_id is null
),
ranked as (
  select
    s.*,
    case s.evidence_stage
      when 'new_lead' then 1
      when 'contacted' then 2
      when 'conversation' then 3
      when 'valuation_scheduled' then 4
      when 'valuation_completed' then 5
      when 'treatment_proposed' then 6
      when 'treatment_scheduled' then 7
      when 'treatment_completed' then 8
      when 'control_scheduled' then 9
      when 'client_completed' then 10
      when 'lost' then 99
      else 0
    end as evidence_rank,
    case s.explicit_stage_normalized
      when 'new_lead' then 1
      when 'contacted' then 2
      when 'conversation' then 3
      when 'valuation_scheduled' then 4
      when 'valuation_completed' then 5
      when 'treatment_proposed' then 6
      when 'treatment_scheduled' then 7
      when 'treatment_completed' then 8
      when 'control_scheduled' then 9
      when 'client_completed' then 10
      when 'lost' then 99
      else 0
    end as explicit_rank
  from stage_candidates s
)
select
  lead_id,
  user_id,
  clinic_id,
  name,
  source,
  campaign_id,
  campaign_name,
  adset_id,
  adset_name,
  ad_id,
  ad_name,
  treatment_name,
  assigned_to,
  next_action,
  due_at,
  lost_reason,
  verified_revenue,
  case
    when evidence_stage='lost' then 'lost'
    when explicit_stage_normalized='lost' then 'lost'
    when explicit_rank > evidence_rank then explicit_stage_normalized
    else evidence_stage
  end as pipeline_stage,
  case
    when explicit_stage_normalized='lost' then 'explicit'
    when evidence_stage<>'lost' and explicit_rank > evidence_rank then 'explicit'
    else 'evidence'
  end as pipeline_stage_source,
  greatest(
    updated_at,
    coalesce(pipeline_updated_at,'epoch'::timestamptz),
    coalesce(last_settled_at,'epoch'::timestamptz),
    coalesce(appointment_matched_at,'epoch'::timestamptz),
    coalesce((last_journey_appointment_date::timestamp at time zone 'Europe/Madrid'),'epoch'::timestamptz)
  ) as stage_evidence_at,
  created_at,
  updated_at,
  journey_appointment_count,
  valuation_appointment_date,
  treatment_appointment_date,
  first_control_appointment_date,
  is_new_client,
  client_completed_at,
  journey_identity_source
from ranked;

revoke all on public.vw_control_centre_pipeline from public, anon, authenticated;
grant select on public.vw_control_centre_pipeline to service_role;

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
  v_clinic uuid;
  v_current text;
  v_old_rank int;
  v_new_rank int;
  v_requested text := case when p_stage='won' then 'client_completed' else p_stage end;
  v_allowed_manual text[] := array['new_lead','contacted','conversation','treatment_proposed','lost'];
  v_rank_order text[] := array[
    'new_lead','contacted','conversation','valuation_scheduled','valuation_completed',
    'treatment_proposed','treatment_scheduled','treatment_completed','control_scheduled','client_completed'
  ];
begin
  if v_user is null then raise exception 'authentication required'; end if;
  select u.clinic_id into v_clinic from public.users u where u.id=v_user;

  if not exists(
    select 1
    from public.leads l
    where l.id=p_lead_id
      and l.deleted_at is null
      and (
        (v_clinic is not null and l.clinic_id=v_clinic)
        or (v_clinic is null and l.user_id=v_user)
      )
  ) then
    raise exception 'lead not found';
  end if;

  select pipeline_stage into v_current
  from public.vw_control_centre_pipeline
  where lead_id=p_lead_id;

  if v_requested is not null then
    if not (v_requested = any(v_allowed_manual)) then
      raise exception 'clinical pipeline stages are derived from Doctoralia visit sequence and cannot be set manually';
    end if;
    if v_current='client_completed' then
      raise exception 'completed client journey cannot be reopened';
    end if;
    if v_requested='treatment_proposed' and array_position(v_rank_order,v_current) < array_position(v_rank_order,'valuation_completed') then
      raise exception 'treatment proposal requires a completed valuation step';
    end if;
    v_old_rank := array_position(v_rank_order,v_current);
    v_new_rank := array_position(v_rank_order,v_requested);
    if v_requested <> 'lost' and v_old_rank is not null and v_new_rank < v_old_rank then
      raise exception 'pipeline stage cannot move backwards';
    end if;
  end if;

  insert into public.lead_pipeline_state(lead_id,explicit_stage,next_action,due_at,lost_reason,updated_by,updated_at)
  values (p_lead_id,v_requested,p_next_action,p_due_at,p_lost_reason,v_user,now())
  on conflict (lead_id) do update set
    explicit_stage=coalesce(excluded.explicit_stage,public.lead_pipeline_state.explicit_stage),
    next_action=coalesce(excluded.next_action,public.lead_pipeline_state.next_action),
    due_at=coalesce(excluded.due_at,public.lead_pipeline_state.due_at),
    lost_reason=coalesce(excluded.lost_reason,public.lead_pipeline_state.lost_reason),
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;

  if v_requested is not null and v_requested is distinct from v_current then
    insert into public.lead_events(
      lead_id,source_platform,source_channel,channel_label,event_type,event_created_at,captured_at,resolution_status,raw_payload,created_at,updated_at
    ) values (
      p_lead_id,'nuvanx','control_centre','Control Centre','pipeline_stage_changed',now(),now(),'resolved',
      jsonb_build_object('previous_stage',v_current,'new_stage',v_requested,'actor_user_id',v_user),now(),now()
    );
  end if;

  return (select to_jsonb(v) from public.vw_control_centre_pipeline v where v.lead_id=p_lead_id);
end;
$$;

revoke all on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) to authenticated, service_role;
