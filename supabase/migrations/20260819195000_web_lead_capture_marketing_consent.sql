-- Persist the explicit server-derived marketing-consent state on the canonical
-- web capture ledger. Missing/legacy senders remain fail-closed as false.
-- This field is purpose-limitation metadata only; it does not trigger any
-- advertising, Deal, or Google side effect.

alter table public.web_lead_captures
  add column if not exists marketing_consent boolean not null default false;

comment on column public.web_lead_captures.marketing_consent is
  'Explicit marketing-consent state derived by the trusted server capture path. False is the fail-closed default for missing or legacy senders.';
