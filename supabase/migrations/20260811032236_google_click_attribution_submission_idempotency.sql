-- Restored historical migration.
-- Production already records version 20260811032236 as
-- google_click_attribution_submission_idempotency.

alter table public.google_click_attributions
  add column if not exists submission_id uuid;

create unique index if not exists google_click_attributions_submission_id_uidx
  on public.google_click_attributions (submission_id)
  where submission_id is not null;
