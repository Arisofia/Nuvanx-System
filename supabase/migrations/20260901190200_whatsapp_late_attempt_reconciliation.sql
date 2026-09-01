-- #363: Reconcile a provider attempt that finishes after stale-sending review.
--
-- Once nvx_mark_whatsapp_payload_sending() succeeds, provider delivery is
-- irrevocably authorized for that claim. A process can pause between that DB
-- transition and the external HTTP call; no database transaction can make that
-- boundary atomic with Meta. The safety invariant is therefore:
--   * stale sending may become manual_review and may never be auto-retried;
--   * the same claim token may still report its eventual provider outcome;
--   * manual_review may become terminal only after the request ledger itself is
--     already in a terminal provider state;
--   * pre-provider manual_review rows can never be promoted by this function.

create or replace function public.nvx_finish_whatsapp_outbound_payload(
  p_request_id uuid,
  p_claim_token uuid,
  p_manual_review boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.whatsapp_outbound_payloads p
  set state = case when p_manual_review then 'manual_review' else 'terminal' end,
      ciphertext = null,
      iv = null,
      completed_at = case
        when p_manual_review then p.completed_at
        else coalesce(p.completed_at, v_now)
      end,
      manual_review_at = case
        when p_manual_review then coalesce(p.manual_review_at, v_now)
        else p.manual_review_at
      end,
      updated_at = v_now
  from public.whatsapp_send_requests r
  where p.request_id = p_request_id
    and r.id = p.request_id
    and p.claim_token = p_claim_token
    and p.state in ('claimed', 'sending', 'manual_review')
    and (
      (
        p_manual_review
        and r.status = 'unknown'
      )
      or (
        not p_manual_review
        and r.status in ('accepted', 'sent', 'delivered', 'read', 'failed')
      )
    );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.nvx_finish_whatsapp_outbound_payload(uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.nvx_finish_whatsapp_outbound_payload(uuid,uuid,boolean)
  to service_role;
