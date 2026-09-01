-- Prevent worker state transitions from recursively producing additional pg_net wakeups.
-- New queue inserts remain event-driven; the one-minute cron in 20260901190000 remains
-- the recovery path for missed dispatches.

drop trigger if exists trg_nvx_wake_whatsapp_outbound on public.whatsapp_outbound_payloads;

create trigger trg_nvx_wake_whatsapp_outbound
after insert on public.whatsapp_outbound_payloads
for each statement execute function public.nvx_wake_whatsapp_outbound_on_queue();
