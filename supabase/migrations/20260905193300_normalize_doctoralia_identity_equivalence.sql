-- =============================================================================
-- Doctoralia identity equivalence normalization
-- 2026-09-05
--
-- Canonical Base Completa may materialize numeric history ids as text like
-- "155.0" while the legacy materialized tab/DB stores "155". Historical rows
-- with blank identity columns may also retain a valid bracketed phone in the
-- subject. Both representations must converge to the same v3 appointment key.
-- =============================================================================

begin;

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
  with raw as (
    select
      nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_doctoralia_id, ''))), '') as doctoralia_id_raw,
      pg_catalog.regexp_replace(coalesce(p_phone, ''), '[^0-9]+', '', 'g') as phone_digits,
      pg_catalog.regexp_replace(
        coalesce(
          pg_catalog.substring(
            coalesce(p_subject, ''),
            '\[([0-9][0-9 +()./-]{7,}[0-9])\]'
          ),
          ''
        ),
        '[^0-9]+',
        '',
        'g'
      ) as subject_phone_digits,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_patient_name, '')), '[[:space:]]+', ' ', 'g')), '') as patient_name,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_subject, '')), '[[:space:]]+', ' ', 'g')), '') as subject,
      p_appointment_date as appointment_date,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_appointment_time, '')), '[[:space:]]+', ' ', 'g')), '') as appointment_time,
      nullif(pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(p_agenda, '')), '[[:space:]]+', ' ', 'g')), '') as agenda
  ), normalized as (
    select
      case
        when doctoralia_id_raw is null then null
        when doctoralia_id_raw ~ '^[0-9]+([.]0+)?$' then
          coalesce(
            nullif(
              pg_catalog.ltrim(
                pg_catalog.split_part(doctoralia_id_raw, '.', 1),
                '0'
              ),
              ''
            ),
            '0'
          )
        else doctoralia_id_raw
      end as doctoralia_id,
      case
        when phone_digits ~ '^0034[0-9]{9}$' then pg_catalog.substring(phone_digits, 5)
        when phone_digits ~ '^34[0-9]{9}$' then pg_catalog.substring(phone_digits, 3)
        when phone_digits ~ '^0+$' then ''
        else phone_digits
      end as phone_normalized,
      case
        when nullif(subject_phone_digits, '') is null then ''
        when pg_catalog.length(subject_phone_digits) < 9 then ''
        when subject_phone_digits = '123456789' then ''
        when subject_phone_digits = pg_catalog.repeat(
          pg_catalog.substring(subject_phone_digits, 1, 1),
          pg_catalog.length(subject_phone_digits)
        ) then ''
        else pg_catalog.right(subject_phone_digits, 9)
      end as subject_phone_normalized,
      patient_name,
      subject,
      appointment_date,
      appointment_time,
      agenda
    from raw
  ), identity as (
    select
      case
        when doctoralia_id is not null then 'id:' || doctoralia_id
        when nullif(phone_normalized, '') is not null then 'ph:' || phone_normalized
        when nullif(subject_phone_normalized, '') is not null then 'ph:' || subject_phone_normalized
        when patient_name is not null then 'name:' || patient_name
        when subject is not null then 'subject:' || subject
        else null
      end as patient_identity,
      appointment_date,
      appointment_time,
      agenda
    from normalized
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

-- Re-key already-migrated v3 rows under the strengthened equivalence contract.
-- The existing UNIQUE(source_key) constraint makes any unexpected collision fail
-- the migration transaction instead of silently dropping or merging history.
with recalculated as (
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
    ) as new_key
  from public.doctoralia_appointments_ingestion a
)
update public.doctoralia_appointments_ingestion a
set
  source_key = r.new_key,
  appointment_id = r.new_key,
  raw_data = pg_catalog.jsonb_set(
    coalesce(a.raw_data, '{}'::jsonb),
    '{source_key_version}',
    '3'::jsonb,
    true
  )
from recalculated r
where a.id = r.id
  and r.new_key is not null
  and a.source_key is distinct from r.new_key;

do $$
begin
  if exists (
    select 1
    from public.doctoralia_appointments_ingestion a
    where public.nvx_doctoralia_appointment_source_key(
      a.doctoralia_id,
      coalesce(a.phone_normalized, a.patient_phone, a.phone),
      a.patient_name,
      a.subject,
      a.appointment_date,
      a.appointment_time,
      a.agenda
    ) is null
  ) then
    raise exception 'Doctoralia identity equivalence migration produced an unkeyable appointment';
  end if;

  if exists (
    select 1
    from public.doctoralia_appointments_ingestion a
    where a.source_key is distinct from public.nvx_doctoralia_appointment_source_key(
      a.doctoralia_id,
      coalesce(a.phone_normalized, a.patient_phone, a.phone),
      a.patient_name,
      a.subject,
      a.appointment_date,
      a.appointment_time,
      a.agenda
    )
  ) then
    raise exception 'Doctoralia identity equivalence migration left non-canonical source keys';
  end if;
end
$$;

commit;
