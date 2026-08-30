create or replace function public.nvx_get_control_centre_pipeline(p_limit integer default 200, p_offset integer default 0)
returns setof public.vw_control_centre_pipeline
language sql
security definer
set search_path = ''
as $$
  select v.*
  from public.vw_control_centre_pipeline v
  where v.user_id = auth.uid()
  order by v.stage_evidence_at desc nulls last, v.created_at desc
  limit greatest(1, least(coalesce(p_limit,200),500))
  offset greatest(coalesce(p_offset,0),0)
$$;
revoke all on function public.nvx_get_control_centre_pipeline(integer,integer) from public, anon;
grant execute on function public.nvx_get_control_centre_pipeline(integer,integer) to authenticated, service_role;

create or replace function public.nvx_get_control_centre_lead_timeline(p_lead_id uuid, p_limit integer default 200)
returns setof public.vw_control_centre_lead_timeline
language sql
security definer
set search_path = ''
as $$
  select t.*
  from public.vw_control_centre_lead_timeline t
  join public.leads l on l.id=t.lead_id
  where t.lead_id=p_lead_id and l.user_id=auth.uid() and l.deleted_at is null
  order by t.event_at desc nulls last
  limit greatest(1, least(coalesce(p_limit,200),500))
$$;
revoke all on function public.nvx_get_control_centre_lead_timeline(uuid,integer) from public, anon;
grant execute on function public.nvx_get_control_centre_lead_timeline(uuid,integer) to authenticated, service_role;
