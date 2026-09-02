-- Forward-only reconciliation for clean-replay metadata drift on
-- public.vw_doctor_performance_real.
--
-- Production's canonical contract has the exact 14-column signature below and
-- no view reloptions. Historical clean replay can retain security_invoker=true
-- even though the public column contract is otherwise identical. Accept only
-- those two known states; fail closed on any third signature or reloption set.

BEGIN;

DO $doctor_performance_reloptions$
DECLARE
  v_signature text;
  v_reloptions text[];
BEGIN
  IF to_regclass('public.vw_doctor_performance_real') IS NULL THEN
    RAISE EXCEPTION 'Cannot reconcile vw_doctor_performance_real reloptions: view is missing';
  END IF;

  SELECT
    string_agg(
      pg_catalog.format(
        '%s:%s:%s',
        a.attnum,
        a.attname,
        pg_catalog.format_type(a.atttypid, a.atttypmod)
      ),
      E'\n' ORDER BY a.attnum
    ),
    c.reloptions
  INTO v_signature, v_reloptions
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = c.oid
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v'
  GROUP BY c.reloptions;

  IF v_signature IS DISTINCT FROM E'1:doctor_id:uuid\n2:doctor_name:character varying(255)\n3:specialty:character varying(128)\n4:is_active:boolean\n5:clinic_id:uuid\n6:total_appointments:bigint\n7:attended_count:bigint\n8:no_show_count:bigint\n9:cancelled_count:bigint\n10:confirmed_count:bigint\n11:attended_rate_pct:numeric\n12:no_show_rate_pct:numeric\n13:estimated_revenue:numeric\n14:verified_revenue_crm:numeric' THEN
    RAISE EXCEPTION 'Unexpected vw_doctor_performance_real signature:%', E'\n' || coalesce(v_signature, '<missing>');
  END IF;

  -- Production canonical state: no reloptions. This branch is intentionally a
  -- no-op when the migration later reaches Production.
  IF v_reloptions IS NULL OR pg_catalog.array_length(v_reloptions, 1) IS NULL THEN
    RETURN;
  END IF;

  -- The only accepted replay drift is the historical invoker-security option.
  IF v_reloptions IS DISTINCT FROM ARRAY['security_invoker=true']::text[] THEN
    RAISE EXCEPTION 'Unexpected vw_doctor_performance_real reloptions: %', v_reloptions;
  END IF;

  ALTER VIEW public.vw_doctor_performance_real RESET (security_invoker);

  SELECT c.reloptions
    INTO v_reloptions
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v';

  IF v_reloptions IS NOT NULL
     AND pg_catalog.array_length(v_reloptions, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'vw_doctor_performance_real reloptions did not reconcile: %', v_reloptions;
  END IF;
END;
$doctor_performance_reloptions$;

COMMIT;
