-- Canonical SLA event: first_response_at is the first provider-accepted WhatsApp
-- text sent by an authenticated human owner of the lead. Automated/template
-- traffic must not call this function.

create or replace function public.mark_lead_human_first_response(
  p_lead_id uuid,
  p_user_id uuid,
  p_sent_at timestamptz default now()
)
returns table(first_outbound_at timestamptz, first_response_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  update public.leads l
  set
    first_outbound_at = coalesce(l.first_outbound_at, p_sent_at),
    first_response_at = coalesce(l.first_response_at, l.first_outbound_at, p_sent_at),
    updated_at = now()
  where l.id = p_lead_id
    and l.user_id = p_user_id
    and l.deleted_at is null
  returning l.first_outbound_at, l.first_response_at;
$$;

revoke all on function public.mark_lead_human_first_response(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.mark_lead_human_first_response(uuid,uuid,timestamptz) to service_role;

comment on function public.mark_lead_human_first_response(uuid,uuid,timestamptz) is
  'Atomically records the first provider-accepted human WhatsApp response and first outbound timestamp for an owned lead.';
