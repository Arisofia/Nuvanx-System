create or replace function public.nvx_get_control_centre_pipeline(p_limit integer default 200, p_offset integer default 0)
returns setof public.vw_control_centre_pipeline
language sql
security definer
set search_path = ''
as $$
  select v.*
  from public.vw_control_centre_pipeline v
  where (
    v.clinic_id is not distinct from (select u.clinic_id from public.users u where u.id = auth.uid())
    and v.clinic_id is not null
  ) or (
    (select u.clinic_id from public.users u where u.id = auth.uid()) is null
    and v.user_id = auth.uid()
  )
  order by v.stage_evidence_at desc nulls last, v.created_at desc, v.lead_id
  limit greatest(1, least(coalesce(p_limit,200),500))
  offset greatest(coalesce(p_offset,0),0)
$$;

create or replace function public.nvx_get_control_centre_lead_timeline(p_lead_id uuid, p_limit integer default 200)
returns setof public.vw_control_centre_lead_timeline
language sql
security definer
set search_path = ''
as $$
  select t.*
  from public.vw_control_centre_lead_timeline t
  join public.leads l on l.id=t.lead_id
  where t.lead_id=p_lead_id
    and l.deleted_at is null
    and (
      (l.clinic_id is not null and l.clinic_id = (select u.clinic_id from public.users u where u.id = auth.uid()))
      or (
        (select u.clinic_id from public.users u where u.id = auth.uid()) is null
        and l.user_id = auth.uid()
      )
    )
  order by t.event_at desc nulls last
  limit greatest(1, least(coalesce(p_limit,200),500))
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
  v_clinic uuid;
  v_current text;
  v_old_rank int;
  v_new_rank int;
  v_allowed text[] := array['new_lead','contacted','conversation','valuation_scheduled','valuation_completed','treatment_proposed','treatment_scheduled','treatment_completed','won','lost'];
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

revoke all on function public.nvx_get_control_centre_pipeline(integer,integer) from public, anon;
grant execute on function public.nvx_get_control_centre_pipeline(integer,integer) to authenticated, service_role;
revoke all on function public.nvx_get_control_centre_lead_timeline(uuid,integer) from public, anon;
grant execute on function public.nvx_get_control_centre_lead_timeline(uuid,integer) to authenticated, service_role;
revoke all on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.nvx_set_lead_pipeline_state(uuid,text,text,timestamptz,text) to authenticated, service_role;
