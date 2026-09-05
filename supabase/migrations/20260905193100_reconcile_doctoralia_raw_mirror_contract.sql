-- Reconcile the clean-preview Doctoralia raw projection with the schema already
-- present in Production and required by nvx_upsert_doctoralia_live_row(text).
-- This is schema parity only; existing Production columns are left unchanged.

begin;

do $$
begin
  if to_regclass('public.doctoralia_raw') is null then
    raise exception 'doctoralia_raw is required by the canonical Doctoralia mirror';
  end if;
end
$$;

alter table if exists public.doctoralia_raw
  add column if not exists processed_at timestamptz,
  add column if not exists ingested_at timestamptz,
  add column if not exists doc_patient_id varchar(16),
  add column if not exists patient_name text,
  add column if not exists appointment_start timestamptz;

comment on column public.doctoralia_raw.processed_at is
  'Timestamp when the canonical Doctoralia raw projection was processed.';
comment on column public.doctoralia_raw.ingested_at is
  'Timestamp inherited from canonical Doctoralia appointment ingestion.';
comment on column public.doctoralia_raw.doc_patient_id is
  'Doctoralia patient identifier used by the canonical live projection.';
comment on column public.doctoralia_raw.patient_name is
  'Patient name projected from canonical Doctoralia appointment ingestion.';
comment on column public.doctoralia_raw.appointment_start is
  'Canonical appointment start timestamp used by Doctoralia live reporting.';

commit;
