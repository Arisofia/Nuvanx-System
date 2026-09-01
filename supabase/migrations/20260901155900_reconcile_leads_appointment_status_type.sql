-- Clean-replay bridge for public.leads.appointment_status.
--
-- Historical Production already carries public.leads.appointment_status as the
-- canonical public.appointment_status enum. Fresh Supabase Preview databases,
-- however, replay 20260501090000_create_leads_table.sql, which creates the
-- column as TEXT. Later reporting migrations compare that column to the enum.
--
-- This migration is intentionally ordered immediately before
-- 20260901160000_fix_reporting_canonical_sources.sql. It is idempotent and a
-- no-op when the column is already the canonical enum. It never rewrites an
-- already-enum Production column and fails closed if unexpected TEXT values
-- would make the conversion lossy.

DO $bridge$
DECLARE
  v_udt_schema text;
  v_udt_name text;
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'public.leads is required before appointment-status replay reconciliation';
  END IF;

  IF to_regtype('public.appointment_status') IS NULL THEN
    RAISE EXCEPTION 'public.appointment_status enum is required before replay reconciliation';
  END IF;

  SELECT c.udt_schema, c.udt_name
    INTO v_udt_schema, v_udt_name
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'leads'
    AND c.column_name = 'appointment_status';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.leads.appointment_status is missing';
  END IF;

  IF v_udt_schema = 'public' AND v_udt_name = 'appointment_status' THEN
    RETURN;
  END IF;

  IF v_udt_schema = 'pg_catalog' AND v_udt_name = 'text' THEN
    IF EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.appointment_status IS NOT NULL
        AND l.appointment_status NOT IN (
          'scheduled',
          'confirmed',
          'showed',
          'no_show',
          'cancelled'
        )
    ) THEN
      RAISE EXCEPTION 'Cannot convert leads.appointment_status to enum: unsupported historical value exists';
    END IF;

    ALTER TABLE public.leads
      ALTER COLUMN appointment_status DROP DEFAULT;

    ALTER TABLE public.leads
      ALTER COLUMN appointment_status TYPE public.appointment_status
      USING appointment_status::public.appointment_status;

    RETURN;
  END IF;

  RAISE EXCEPTION
    'Unexpected public.leads.appointment_status type %.%; expected pg_catalog.text or public.appointment_status',
    v_udt_schema,
    v_udt_name;
END
$bridge$;
