-- Forward-only reconciliation for clean-replay metadata drift on
-- public.vw_doctor_performance_real.
--
-- Production's canonical contract has the exact 14-column signature below and
-- must have security_invoker=true to maintain the reporting security boundary.
-- If the view is missing this reloption, it will be added. Accept only this
-- known state; fail closed on any third signature or extra reloption set.

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

  -- The canonical state requires security_invoker=true for security.
  -- If it's already set, we're good. If it's missing, we set it.
  IF v_reloptions IS NOT DISTINCT FROM ARRAY['security_invoker=true']::text[] THEN
    RETURN;
  END IF;

  IF v_reloptions IS NOT NULL AND pg_catalog.array_length(v_reloptions, 1) > 0 THEN
    RAISE EXCEPTION 'Unexpected vw_doctor_performance_real reloptions: %', v_reloptions;
  END IF;

  ALTER VIEW public.vw_doctor_performance_real SET (security_invoker = true);
END;
$doctor_performance_reloptions$;

COMMIT;
