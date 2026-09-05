-- =============================================================================
-- Preserve legacy Doctoralia financial materialization as non-financial evidence
-- 2026-09-05
--
-- The legacy Doctoralia writer copied appointment-level values into
-- public.financial_settlements even though no paid/settled-cash contract had been
-- proven. The following migration (20260905193000) removes those rows from the
-- verified financial authority. Before that correction is allowed to delete any
-- row, this migration preserves the exact database snapshot as immutable audit
-- evidence with explicit non-financial semantics.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.financial_settlements') is null then
    raise exception 'financial_settlements is required for Doctoralia evidence preservation';
  end if;
end
$$;

create table if not exists public.doctoralia_financial_materialization_evidence (
  original_row_id text primary key,
  source_snapshot jsonb not null,
  financial_semantics text not null default 'appointment_value_unverified',
  evidence_reason text not null default 'legacy_doctoralia_materialization_not_verified_cash',
  captured_at timestamptz not null default now(),
  constraint doctoralia_financial_evidence_semantics_check
    check (financial_semantics = 'appointment_value_unverified'),
  constraint doctoralia_financial_evidence_reason_check
    check (evidence_reason = 'legacy_doctoralia_materialization_not_verified_cash')
);

comment on table public.doctoralia_financial_materialization_evidence is
  'Audit-only snapshots of legacy Doctoralia appointment-value rows formerly stored in financial_settlements. These rows are evidence, not paid/settled cash and not verified revenue.';

alter table public.doctoralia_financial_materialization_evidence enable row level security;
revoke all on table public.doctoralia_financial_materialization_evidence from public, anon, authenticated;
grant select on table public.doctoralia_financial_materialization_evidence to service_role;

insert into public.doctoralia_financial_materialization_evidence (
  original_row_id,
  source_snapshot,
  financial_semantics,
  evidence_reason
)
select
  fs.id::text,
  to_jsonb(fs),
  'appointment_value_unverified',
  'legacy_doctoralia_materialization_not_verified_cash'
from public.financial_settlements fs
where pg_catalog.lower(pg_catalog.btrim(coalesce(fs.source_system, ''))) = 'doctoralia'
on conflict (original_row_id) do update
set
  source_snapshot = excluded.source_snapshot,
  financial_semantics = 'appointment_value_unverified',
  evidence_reason = 'legacy_doctoralia_materialization_not_verified_cash';

-- Fail closed unless every row that is about to leave the financial authority
-- has an exact JSONB snapshot keyed by its durable database row id.
do $$
declare
  v_source_count bigint;
  v_exact_evidence_count bigint;
begin
  select count(*)
  into v_source_count
  from public.financial_settlements fs
  where pg_catalog.lower(pg_catalog.btrim(coalesce(fs.source_system, ''))) = 'doctoralia';

  select count(*)
  into v_exact_evidence_count
  from public.financial_settlements fs
  join public.doctoralia_financial_materialization_evidence e
    on e.original_row_id = fs.id::text
   and e.source_snapshot = to_jsonb(fs)
   and e.financial_semantics = 'appointment_value_unverified'
   and e.evidence_reason = 'legacy_doctoralia_materialization_not_verified_cash'
  where pg_catalog.lower(pg_catalog.btrim(coalesce(fs.source_system, ''))) = 'doctoralia';

  if v_exact_evidence_count <> v_source_count then
    raise exception
      'Doctoralia financial evidence preservation incomplete: source %, exact evidence %',
      v_source_count,
      v_exact_evidence_count;
  end if;
end
$$;

-- The downstream boundary migration performs the actual authority cleanup.
-- Guard that DELETE at the database boundary so it can never silently discard a
-- Doctoralia row whose exact pre-delete snapshot was not preserved first.
create or replace function public.nvx_require_doctoralia_financial_evidence_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if pg_catalog.lower(pg_catalog.btrim(coalesce(old.source_system, ''))) <> 'doctoralia' then
    return old;
  end if;

  if not exists (
    select 1
    from public.doctoralia_financial_materialization_evidence e
    where e.original_row_id = old.id::text
      and e.source_snapshot = to_jsonb(old)
      and e.financial_semantics = 'appointment_value_unverified'
      and e.evidence_reason = 'legacy_doctoralia_materialization_not_verified_cash'
  ) then
    raise exception 'Doctoralia financial row cannot be removed before exact evidence preservation';
  end if;

  return old;
end
$function$;

revoke all on function public.nvx_require_doctoralia_financial_evidence_before_delete()
  from public, anon, authenticated;

drop trigger if exists trg_require_doctoralia_financial_evidence_before_delete
  on public.financial_settlements;
create trigger trg_require_doctoralia_financial_evidence_before_delete
before delete on public.financial_settlements
for each row
execute function public.nvx_require_doctoralia_financial_evidence_before_delete();

commit;
