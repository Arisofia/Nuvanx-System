create or replace function public.nvx_get_control_centre_pipeline(p_limit integer default 200, p_offset integer default 0)
returns setof public.vw_control_centre_pipeline
language sql
security definer
set search_path = ''
as $$
  select v.*
  from public.vw_control_centre_pipeline v
  where v.user_id = auth.uid()
  order by v.stage_evidence_at desc nulls last, v.created_at desc, v.lead_id
  limit greatest(1, least(coalesce(p_limit,200),500))
  offset greatest(coalesce(p_offset,0),0)
$$;

revoke all on function public.nvx_get_control_centre_pipeline(integer,integer) from public, anon;
grant execute on function public.nvx_get_control_centre_pipeline(integer,integer) to authenticated, service_role;
