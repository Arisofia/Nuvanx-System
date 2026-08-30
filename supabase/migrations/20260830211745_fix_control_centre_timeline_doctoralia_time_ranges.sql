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
       (
         a.appointment_date::text || ' ' ||
         coalesce(substring(coalesce(a.appointment_time,'') from '((?:[01][0-9]|2[0-3]):[0-5][0-9])'),'12:00')
       )::timestamp at time zone 'Europe/Madrid',
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
