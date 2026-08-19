-- Canonical first-party capture ledger for NUVANX web/HubSpot submissions.
-- Stores lineage and non-clinical attribution only. It does not create Deals,
-- send advertising feedback, or overload public.leads(id).

create table if not exists public.web_lead_captures (
  id uuid primary key default gen_random_uuid(),
  nvx_lead_id uuid not null unique,
  form_id text not null,
  hubspot_contact_id bigint,
  hubspot_submission_id text,
  email_hash text,
  is_test_lead boolean not null default false,
  test_run_id text,
  first_attribution jsonb not null default '{}'::jsonb,
  conversion_attribution jsonb not null default '{}'::jsonb,
  source text not null default 'hubspot_web',
  captured_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  applied_lead_id uuid references public.leads(id) on delete set null,
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint web_lead_captures_email_hash_check
    check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  constraint web_lead_captures_form_id_check
    check (length(form_id) between 1 and 80),
  constraint web_lead_captures_test_run_id_check
    check (test_run_id is null or length(test_run_id) <= 128),
  constraint web_lead_captures_submission_id_check
    check (hubspot_submission_id is null or length(hubspot_submission_id) <= 180),
  constraint web_lead_captures_source_check
    check (source = 'hubspot_web')
);

comment on table public.web_lead_captures is
  'Canonical first-party ledger of successful NUVANX web/HubSpot captures keyed by nvx_lead_id. Contains no raw email, phone or clinical semantics and causes no advertising/Deal side effects.';

comment on column public.web_lead_captures.nvx_lead_id is
  'Stable first-party capture lineage UUID shared with HubSpot. Distinct from public.leads(id).';
comment on column public.web_lead_captures.applied_lead_id is
  'Optional operational public.leads(id) resolved later by a trusted reconciliation process.';
comment on column public.web_lead_captures.is_test_lead is
  'Server-owned QA marker. Downstream Deal, SLA and advertising feedback must hard-stop when true.';

create index if not exists web_lead_captures_hubspot_contact_id_idx
  on public.web_lead_captures (hubspot_contact_id)
  where hubspot_contact_id is not null;

create index if not exists web_lead_captures_applied_lead_id_idx
  on public.web_lead_captures (applied_lead_id)
  where applied_lead_id is not null;

create index if not exists web_lead_captures_captured_at_idx
  on public.web_lead_captures (captured_at desc);

alter table public.web_lead_captures enable row level security;
-- Deliberately no public/authenticated policies. service_role/internal functions only.
