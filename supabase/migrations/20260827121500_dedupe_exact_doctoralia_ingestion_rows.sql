-- Remove exact duplicate Doctoralia appointment rows while preserving business
-- history (for example Pendiente vs Anulada / No Acude) and protect every
-- writer from reintroducing byte-equivalent business records under a different
-- sheet-row-derived source_key.
--
-- Identity/audit fields intentionally excluded from duplicate equivalence:
-- id, sheet_row, source_key, appointment_id, raw_data, imported_at, updated_at.

begin;

create temporary table nvx_doctoralia_exact_duplicate_candidates
on commit drop
as
with ranked as (
  select
    a.id,
    row_number() over (
      partition by (
        to_jsonb(a)
        - array[
            'id',
            'sheet_row',
            'source_key',
            'appointment_id',
            'raw_data',
            'imported_at',
            'updated_at'
          ]::text[]
      )
      order by a.sheet_row asc nulls last, a.id asc
    ) as duplicate_rank
  from public.doctoralia_appointments_ingestion as a
)
select id
from ranked
where duplicate_rank > 1;

-- Fail closed if a row selected for deletion participates in lead matching.
do $$
begin
  if exists (
    select 1
    from nvx_doctoralia_exact_duplicate_candidates as candidate
    join public.lead_appointment_matches as match
      on match.appointment_ingestion_id = candidate.id
  ) then
    raise exception 'Doctoralia exact-dedupe candidate is referenced by lead_appointment_matches';
  end if;
end
$$;

delete from public.doctoralia_appointments_ingestion as appointment
using nvx_doctoralia_exact_duplicate_candidates as candidate
where appointment.id = candidate.id;

create or replace function public.nvx_guard_exact_doctoralia_appointment_duplicate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ignored_fields constant text[] := array[
    'id',
    'sheet_row',
    'source_key',
    'appointment_id',
    'raw_data',
    'imported_at',
    'updated_at'
  ];
begin
  if exists (
    select 1
    from public.doctoralia_appointments_ingestion as existing
    where existing.id is distinct from new.id
      and (to_jsonb(existing) - v_ignored_fields) = (to_jsonb(new) - v_ignored_fields)
  ) then
    if tg_op = 'INSERT' then
      -- The canonical Doctoralia source occasionally contains adjacent,
      -- business-identical rows with different sheet_row values. Keep the
      -- first row already persisted and skip only the exact duplicate insert.
      return null;
    end if;

    -- An UPDATE becoming identical to another appointment is ambiguous and
    -- must be investigated instead of silently discarding the update.
    raise exception 'Doctoralia update would create an exact business duplicate';
  end if;

  return new;
end
$$;

revoke all on function public.nvx_guard_exact_doctoralia_appointment_duplicate() from public;
revoke all on function public.nvx_guard_exact_doctoralia_appointment_duplicate() from anon;
revoke all on function public.nvx_guard_exact_doctoralia_appointment_duplicate() from authenticated;

drop trigger if exists trg_guard_exact_doctoralia_appointment_duplicate
  on public.doctoralia_appointments_ingestion;

create trigger trg_guard_exact_doctoralia_appointment_duplicate
before insert or update on public.doctoralia_appointments_ingestion
for each row
execute function public.nvx_guard_exact_doctoralia_appointment_duplicate();

-- The migration must leave no exact business duplicates behind.
do $$
begin
  if exists (
    select 1
    from public.doctoralia_appointments_ingestion as a
    group by (
      to_jsonb(a)
      - array[
          'id',
          'sheet_row',
          'source_key',
          'appointment_id',
          'raw_data',
          'imported_at',
          'updated_at'
        ]::text[]
    )
    having count(*) > 1
  ) then
    raise exception 'Exact Doctoralia business duplicates remain after dedupe';
  end if;
end
$$;

commit;
