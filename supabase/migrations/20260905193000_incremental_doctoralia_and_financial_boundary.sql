-- =============================================================================
-- Doctoralia incremental appointment authority + financial trust boundary
-- 2026-09-05
--
-- One canonical Doctoralia owner exists: appointment ingestion from
-- Base Completa Doctoralia. Appointment rows are incrementally inserted or
-- updated by stable appointment-slot identity. Doctoralia appointment values
-- are not financial settlements and must never be promoted to verified cash.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.doctoralia_appointments_ingestion') is null then
    raise exception 'doctoralia_appointments_ingestion is required';
  end if;
  if to_regclass('public.financial_settlements') is null then
    raise exception 'financial_settlements is required';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception 'pgcrypto is required for Doctoralia SHA-256 appointment identity';
  end if;
end
$$;

-- Stable appointment identity. Doctoralia does not expose a provider-level
-- appointment id in this export, so the narrowest stable key is:
-- patient identity + scheduled date + scheduled time + agenda.
-- Mutable lifecycle fields (Estado, Importe, Concepto cita, sheet row) are
-- deliberately excluded so they update the same appointment record.
create or replace function public.nvx_doctoralia_appointment_source_key(
  p_doctoralia_id text,
  p_phone text,
  p_patient_name text,
  p_subject text,
  p_appointment_date date,
  p_appointment_time text,
  p_agenda text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  with normalized as (
    select
      nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_doctoralia_id, ''))), '') as doctoralia_id,
      pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]+', '', 'g') as phone_digits,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_patient_name, '')), '[[:space:]]+', ' ', 'g')), '') as patient_name,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_subject, '')), '[[:space:]]+', ' ', 'g')), '') as subject,
      p_appointment_date as appointment_date,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_appointment_time, '')), '[[:space:]]+', ' ', 'g')), '') as appointment_time,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_agenda, '')), '[[:space:]]+', ' ', 'g')), '') as agenda
  ), normalized_phone as (
    select
      *,
      case
        when phone_digits ~ '^0034[0-9]{9}$' then pg_catalog.substring(phone_digits, 5)
        when phone_digits ~ '^34[0-9]{9}$' then pg_catalog.substring(phone_digits, 3)
        when phone_digits ~ '^0+$' then ''
        else phone_digits
      end as phone_normalized
    from normalized
  ), identity as (
    select
      case
        when doctoralia_id is not null then 'id:' || doctoralia_id
        when nullif(phone_normalized, '') is not null then 'ph:' || phone_normalized
        when patient_name is not null then 'name:' || patient_name
        when subject is not null then 'subject:' || subject
        else null
      end as patient_identity,
      appointment_date,
      appointment_time,
      agenda
    from normalized_phone
  )
  select case
    when patient_identity is null
      or appointment_date is null
      or appointment_time is null
      or agenda is null
      then null
    else 'doctoralia_appt_v3:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.concat_ws(
            '|',
            patient_identity,
            appointment_date::text,
            appointment_time,
            agenda
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end
  from identity;
$function$;

revoke all on function public.nvx_doctoralia_appointment_source_key(text,text,text,text,date,text,text)
  from public, anon, authenticated;
grant execute on function public.nvx_doctoralia_appointment_source_key(text,text,text,text,date,text,text)
  to service_role;

-- Build the new stable identity for every existing appointment before mutation.
create temporary table nvx_doctoralia_incremental_rank
on commit drop
as
select
  a.id,
  public.nvx_doctoralia_appointment_source_key(
    a.doctoralia_id,
    coalesce(a.phone_normalized, a.patient_phone, a.phone),
    a.patient_name,
    a.subject,
    a.appointment_date,
    a.appointment_time,
    a.agenda
  ) as stable_key,
  row_number() over (
    partition by public.nvx_doctoralia_appointment_source_key(
      a.doctoralia_id,
      coalesce(a.phone_normalized, a.patient_phone, a.phone),
      a.patient_name,
      a.subject,
      a.appointment_date,
      a.appointment_time,
      a.agenda
    )
    order by a.sheet_row desc nulls last, a.updated_at desc nulls last, a.id desc
  ) as snapshot_rank
from public.doctoralia_appointments_ingestion a;

do $$
begin
  if exists (
    select 1
    from nvx_doctoralia_incremental_rank
    where stable_key is null
  ) then
    raise exception 'Doctoralia stable appointment identity could not be derived for every existing row';
  end if;

  if to_regclass('public.lead_appointment_matches') is not null and exists (
    select 1
    from nvx_doctoralia_incremental_rank r
    join public.lead_appointment_matches m
      on m.appointment_ingestion_id = r.id
    where r.snapshot_rank > 1
  ) then
    raise exception 'A Doctoralia lifecycle snapshot selected for consolidation is referenced by lead_appointment_matches';
  end if;
end
$$;

-- The old trigger compared complete business payloads and therefore preserved
-- lifecycle snapshots with different statuses. Stable slot identity supersedes
-- it; unique(source_key) becomes the canonical duplicate/concurrency guard.
drop trigger if exists trg_guard_exact_doctoralia_appointment_duplicate
  on public.doctoralia_appointments_ingestion;
drop function if exists public.nvx_guard_exact_doctoralia_appointment_duplicate();

-- Keep the latest source snapshot for each appointment slot. Production
-- preflight on 2026-09-05 showed no loser row referenced by lead matching.
delete from public.doctoralia_appointments_ingestion a
using nvx_doctoralia_incremental_rank r
where a.id = r.id
  and r.snapshot_rank > 1;

-- sheet_row is only source-position metadata. Row movement in Drive must not
-- create/delete appointments or violate uniqueness.
alter table public.doctoralia_appointments_ingestion
  drop constraint if exists doctoralia_appointments_ingestion_sheet_row_key;
create index if not exists idx_doctoralia_appointments_ingestion_sheet_row
  on public.doctoralia_appointments_ingestion(sheet_row);

-- Migrate surviving rows to v3 stable identity.
update public.doctoralia_appointments_ingestion a
set
  source_key = r.stable_key,
  appointment_id = r.stable_key,
  raw_data = coalesce(a.raw_data, '{}'::jsonb) || jsonb_build_object('source_key_version', 3),
  updated_at = now()
from nvx_doctoralia_incremental_rank r
where a.id = r.id
  and r.snapshot_rank = 1;

alter table public.doctoralia_appointments_ingestion
  drop constraint if exists doctoralia_appointments_ingestion_source_key_v3_check;
alter table public.doctoralia_appointments_ingestion
  add constraint doctoralia_appointments_ingestion_source_key_v3_check
  check (source_key ~ '^doctoralia_appt_v3:[0-9a-f]{64}$') not valid;
alter table public.doctoralia_appointments_ingestion
  validate constraint doctoralia_appointments_ingestion_source_key_v3_check;

-- Normalize every future writer at the DB boundary. This protects the stable
-- identity even if a stale client still sends row-derived v2 keys.
create or replace function public.nvx_normalize_doctoralia_appointment_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_key text;
begin
  v_key := public.nvx_doctoralia_appointment_source_key(
    new.doctoralia_id,
    coalesce(new.phone_normalized, new.patient_phone, new.phone),
    new.patient_name,
    new.subject,
    new.appointment_date,
    new.appointment_time,
    new.agenda
  );

  if v_key is null then
    raise exception 'Doctoralia appointment stable identity is incomplete';
  end if;

  new.source_key := v_key;
  new.appointment_id := v_key;
  new.raw_data := coalesce(new.raw_data, '{}'::jsonb) || jsonb_build_object('source_key_version', 3);
  return new;
end
$function$;

revoke all on function public.nvx_normalize_doctoralia_appointment_identity()
  from public, anon, authenticated;

drop trigger if exists trg_normalize_doctoralia_appointment_identity
  on public.doctoralia_appointments_ingestion;
create trigger trg_normalize_doctoralia_appointment_identity
before insert or update of doctoralia_id, phone_normalized, patient_phone, phone, patient_name, subject, appointment_date, appointment_time, agenda, source_key, appointment_id
on public.doctoralia_appointments_ingestion
for each row
execute function public.nvx_normalize_doctoralia_appointment_identity();

-- Full-table replacement is not a valid sync operation. Deletes require an
-- explicit transaction-local maintenance override; routine service-role syncs
-- cannot wipe the appointment history.
create or replace function public.nvx_guard_doctoralia_appointment_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.current_setting('nvx.allow_doctoralia_appointment_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Direct Doctoralia appointment deletion is blocked; use incremental reconciliation';
end
$function$;

revoke all on function public.nvx_guard_doctoralia_appointment_delete()
  from public, anon, authenticated;

drop trigger if exists trg_guard_doctoralia_appointment_delete
  on public.doctoralia_appointments_ingestion;
create trigger trg_guard_doctoralia_appointment_delete
before delete on public.doctoralia_appointments_ingestion
for each row
execute function public.nvx_guard_doctoralia_appointment_delete();

-- Financial trust boundary.
--
-- Production preflight established that source_system='doctoralia' contains two
-- historically conflated contracts:
--   * appointment materialization produced by the retired sync-doctoralia.js;
--     those rows carry the Doctoralia Asunto shape "<id>. NAME [phone] (...)";
--   * six pre-existing financing/settlement rows whose template_name is a real
--     financial product (for example EXPRESS/CAMPAÑA), with DNI/template_id and
--     no appointment status. They are not proven to have been produced by the
--     retired appointment writer and therefore must not be deleted by this fix.
--
-- Remove only the row class proven to be appointment materialization. No second
-- archive/quarantine table is created.
delete from public.financial_settlements
where pg_catalog.lower(pg_catalog.btrim(coalesce(source_system, ''))) = 'doctoralia'
  and coalesce(template_name, '') ~ '^(O/)?[0-9]+[.] .*\[.*\]';

-- Fail closed if any appointment-shaped Doctoralia settlement survived. This is
-- a contract assertion, not a blanket ban on Doctoralia as a future verified
-- financial provider.
do $$
begin
  if exists (
    select 1
    from public.financial_settlements
    where pg_catalog.lower(pg_catalog.btrim(coalesce(source_system, ''))) = 'doctoralia'
      and coalesce(template_name, '') ~ '^(O/)?[0-9]+[.] .*\[.*\]'
  ) then
    raise exception 'Doctoralia appointment materialization remains in financial_settlements after cleanup';
  end if;
end
$$;

alter table if exists public.financial_settlements
  drop constraint if exists financial_settlements_no_doctoralia_appointment_materialization;
alter table if exists public.financial_settlements
  add constraint financial_settlements_no_doctoralia_appointment_materialization
  check (
    not (
      pg_catalog.lower(pg_catalog.btrim(coalesce(source_system, ''))) = 'doctoralia'
      and coalesce(template_name, '') ~ '^(O/)?[0-9]+[.] .*\[.*\]'
    )
  )
  not valid;
alter table if exists public.financial_settlements
  validate constraint financial_settlements_no_doctoralia_appointment_materialization;

comment on table public.financial_settlements is
  'Financial settlement authority. Doctoralia appointment-shaped materializations are prohibited; non-appointment financial rows require their own verified financial provenance.';

-- Patient identity is operational evidence and must derive from canonical
-- appointments, not from financial rows or positive appointment amounts.
create or replace function public.sync_doctoralia_patients()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'extensions'
as $function$
declare
  v_affected integer := 0;
begin
  insert into public.doctoralia_patients (
    doc_patient_id,
    clinic_id,
    full_name,
    name_norm,
    phone_primary,
    phone_normalized,
    first_seen_at,
    match_confidence,
    match_class
  )
  select
    src.doc_patient_id,
    src.clinic_id,
    max(upper(btrim(src.patient_name))) as full_name,
    max(lower(regexp_replace(extensions.unaccent(btrim(src.patient_name)), '[[:space:]]+', ' ', 'g'))) as name_norm,
    max(src.phone_primary) as phone_primary,
    max(src.phone_normalized) as phone_normalized,
    min(src.first_seen_at) as first_seen_at,
    1.0 as match_confidence,
    case when bool_or(src.has_doctoralia_id) then 'doctoralia_id' else 'phone_match' end as match_class
  from (
    select
      coalesce(
        nullif(btrim(a.doctoralia_id), ''),
        case
          when nullif(btrim(a.phone_normalized), '') is not null
            then 'ph:' || btrim(a.phone_normalized)
          else null
        end
      ) as doc_patient_id,
      a.clinic_id,
      nullif(btrim(a.patient_name), '') as patient_name,
      coalesce(
        nullif(btrim(a.phone_primary), ''),
        nullif(btrim(a.phone_raw), ''),
        nullif(btrim(a.phone), ''),
        nullif(btrim(a.patient_phone), '')
      ) as phone_primary,
      nullif(btrim(a.phone_normalized), '') as phone_normalized,
      coalesce(
        a.fecha_creacion,
        a.created_at,
        (coalesce(a.appointment_date, a.fecha)::timestamp at time zone 'Europe/Madrid')
      ) as first_seen_at,
      nullif(btrim(a.doctoralia_id), '') is not null as has_doctoralia_id
    from public.doctoralia_appointments a
    where a.clinic_id is not null
      and nullif(btrim(a.patient_name), '') is not null
      and (
        nullif(btrim(a.doctoralia_id), '') is not null
        or nullif(btrim(a.phone_normalized), '') is not null
      )
  ) src
  where src.doc_patient_id is not null
  group by src.doc_patient_id, src.clinic_id
  on conflict (doc_patient_id, clinic_id) do update
  set
    full_name = coalesce(excluded.full_name, doctoralia_patients.full_name),
    name_norm = coalesce(excluded.name_norm, doctoralia_patients.name_norm),
    phone_primary = coalesce(excluded.phone_primary, doctoralia_patients.phone_primary),
    phone_normalized = coalesce(excluded.phone_normalized, doctoralia_patients.phone_normalized),
    first_seen_at = case
      when doctoralia_patients.first_seen_at is null then excluded.first_seen_at
      when excluded.first_seen_at is null then doctoralia_patients.first_seen_at
      else least(doctoralia_patients.first_seen_at, excluded.first_seen_at)
    end,
    match_confidence = greatest(
      coalesce(doctoralia_patients.match_confidence, 0),
      coalesce(excluded.match_confidence, 0)
    ),
    match_class = case
      when doctoralia_patients.match_class = 'dni_match' then doctoralia_patients.match_class
      else excluded.match_class
    end,
    updated_at = now();

  get diagnostics v_affected = row_count;
  return v_affected;
end
$function$;

comment on function public.sync_doctoralia_patients() is
  'Refreshes Doctoralia patient identity from canonical doctoralia_appointments; financial_settlements is not an identity or appointment source.';

commit;
