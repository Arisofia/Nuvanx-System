create or replace view public.vw_control_centre_pipeline
with (security_invoker = true)
as
with revenue as (
  select lead_id,
         sum(amount_net) filter (where cancelled_at is null) as settled_revenue,
         max(settled_at) filter (where cancelled_at is null) as last_settled_at
  from public.financial_settlements
  where lead_id is not null
  group by lead_id
), appt as (
  select m.lead_id,
         max(a.appointment_date) filter (
           where coalesce(a.is_cancelled,false)=false
             and a.appointment_date is not null
             and a.appointment_date >= l.created_at::date
         ) as last_appointment_date,
         max(m.matched_at) as last_match_at,
         bool_or(
           coalesce(a.is_cancelled,false)=false
           and a.appointment_date is not null
           and a.appointment_date >= l.created_at::date
         ) as has_booked_appointment,
         bool_or(
           coalesce(a.is_cancelled,false)=false
           and a.appointment_date is not null
           and a.appointment_date >= l.created_at::date
           and lower(coalesce(a.status,a.estado,'')) in ('showed','completed','completada','completado','realizada','realizado','atendida','atendido')
         ) as has_completed_appointment
  from public.lead_appointment_matches m
  join public.doctoralia_appointments_ingestion a on a.id=m.appointment_ingestion_id
  join public.leads l on l.id=m.lead_id
  where m.is_primary is true
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
  coalesce(p.lost_reason,l.lost_reason::text) as lost_reason,
  coalesce(r.settled_revenue,0) as verified_revenue,
  coalesce(
    p.explicit_stage,
    case
      when l.lost_reason is not null or lower(coalesce(l.stage,'')) in ('lost','perdido') then 'lost'
      when coalesce(r.settled_revenue,0)>0 then 'won'
      when coalesce(a.has_completed_appointment,false) then 'valuation_completed'
      when coalesce(a.has_booked_appointment,false) then 'valuation_scheduled'
      when l.first_inbound_at is not null then 'conversation'
      when l.first_outbound_at is not null or l.first_response_at is not null then 'contacted'
      else 'new_lead'
    end
  ) as pipeline_stage,
  case when p.explicit_stage is not null then 'explicit' else 'evidence' end as pipeline_stage_source,
  greatest(
    l.updated_at,
    coalesce(p.updated_at,'epoch'::timestamptz),
    coalesce(r.last_settled_at,'epoch'::timestamptz),
    coalesce(a.last_match_at,'epoch'::timestamptz)
  ) as stage_evidence_at,
  l.created_at,
  l.updated_at
from public.leads l
left join public.lead_pipeline_state p on p.lead_id=l.id
left join revenue r on r.lead_id=l.id
left join appt a on a.lead_id=l.id
where l.deleted_at is null and l.merged_into_lead_id is null;

revoke all on public.vw_control_centre_pipeline from public, anon, authenticated;
grant select on public.vw_control_centre_pipeline to service_role;
