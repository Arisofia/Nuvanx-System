-- Forward-only pre-reconciliation for the historical doctor performance view.
--
-- This version is ordered after the immutable 20260901155900 bridge and its
-- column-ACL preflight, but before the already-applied 20260901160000 reporting
-- migration. Production already has the canonical 14-column signature and is a
-- no-op here. Clean replay may still carry the exact historical signature with
-- clinic_id at ordinal 14; rebuild only that known shape so CREATE OR REPLACE in
-- the immutable reporting migration can execute without changing its history.

BEGIN;

DO $doctor_order_bridge$
DECLARE
  v_signature text;
  v_reloptions text[];
  v_owner_name text;
  v_acl record;
BEGIN
  IF to_regclass('public.vw_doctor_performance_real') IS NULL THEN
    RAISE EXCEPTION 'vw_doctor_performance_real is required before reporting pre-reconciliation';
  END IF;

  SELECT string_agg(
           pg_catalog.format(
             '%s:%s:%s',
             a.attnum,
             a.attname,
             pg_catalog.format_type(a.atttypid, a.atttypmod)
           ),
           E'\n' ORDER BY a.attnum
         ),
         c.reloptions,
         pg_catalog.pg_get_userbyid(c.relowner)
    INTO v_signature, v_reloptions, v_owner_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = c.oid
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v'
  GROUP BY c.reloptions, c.relowner;

  -- Production/current canonical signature: do not mutate it.
  IF v_signature = E'1:doctor_id:uuid\n2:doctor_name:character varying(255)\n3:specialty:character varying(128)\n4:is_active:boolean\n5:clinic_id:uuid\n6:total_appointments:bigint\n7:attended_count:bigint\n8:no_show_count:bigint\n9:cancelled_count:bigint\n10:confirmed_count:bigint\n11:attended_rate_pct:numeric\n12:no_show_rate_pct:numeric\n13:estimated_revenue:numeric\n14:verified_revenue_crm:numeric' THEN
    RETURN;
  END IF;

  -- Only the exact historical clean-replay shape is eligible for rebuild.
  IF v_signature IS DISTINCT FROM E'1:doctor_id:uuid\n2:doctor_name:text\n3:specialty:text\n4:is_active:boolean\n5:total_appointments:bigint\n6:attended_count:bigint\n7:no_show_count:bigint\n8:cancelled_count:bigint\n9:confirmed_count:bigint\n10:attended_rate_pct:numeric\n11:no_show_rate_pct:numeric\n12:estimated_revenue:numeric\n13:verified_revenue_crm:numeric\n14:clinic_id:uuid' THEN
    RAISE EXCEPTION 'Unexpected vw_doctor_performance_real signature before reporting migration:%', E'\n' || coalesce(v_signature, '<missing>');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class parent
    JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
    JOIN pg_catalog.pg_depend d ON d.refobjid = parent.oid
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class child ON child.oid = r.ev_class
    WHERE pn.nspname = 'public'
      AND parent.relname = 'vw_doctor_performance_real'
      AND parent.relkind = 'v'
      AND child.oid <> parent.oid
      AND child.relkind IN ('v', 'm')
  ) THEN
    RAISE EXCEPTION 'Cannot rebuild legacy vw_doctor_performance_real: dependent view exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.vw_doctor_performance_real'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_doctor_performance_real: column-level ACLs detected';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.doctors d
    WHERE (d.name IS NOT NULL AND char_length(d.name) > 255)
       OR (d.specialty IS NOT NULL AND char_length(d.specialty) > 128)
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_doctor_performance_real: doctor text exceeds canonical varchar bounds';
  END IF;

  CREATE TEMP TABLE nvx_doctor_pre_acl ON COMMIT DROP AS
  SELECT
    pg_catalog.pg_get_userbyid(acl.grantor) AS grantor_name,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee_name,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v'
    AND c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  IF EXISTS (
    SELECT 1 FROM nvx_doctor_pre_acl
    WHERE grantor_name IS DISTINCT FROM current_user
  ) THEN
    RAISE EXCEPTION 'Cannot reproduce vw_doctor_performance_real ACL grantors as current_user=%', current_user;
  END IF;

  DROP VIEW public.vw_doctor_performance_real;

  EXECUTE $view$
    CREATE VIEW public.vw_doctor_performance_real AS
    WITH doctoralia_agg AS (
      SELECT
        a.doctor_id,
        count(*)::bigint AS total_appointments,
        count(*) FILTER (
          WHERE lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), '')))
                IN ('pagada', 'realizada', 'showed', 'completed')
        )::bigint AS attended_count,
        count(*) FILTER (
          WHERE lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), '')))
                IN ('no acude', 'no acudió', 'no acudio', 'no_show', 'no show', 'noshow')
        )::bigint AS no_show_count,
        count(*) FILTER (
          WHERE COALESCE(a.is_cancelled, false)
             OR lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), '')))
                IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled', 'canceled')
        )::bigint AS cancelled_count,
        count(*) FILTER (
          WHERE a.appointment_date IS NOT NULL
            AND NOT COALESCE(a.is_cancelled, false)
            AND lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), '')))
                NOT IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled', 'canceled', 'no acude', 'no acudió', 'no acudio', 'no_show', 'no show', 'noshow')
        )::bigint AS confirmed_count,
        round(COALESCE(sum(COALESCE(a.amount, 0)) FILTER (
          WHERE NOT COALESCE(a.is_cancelled, false)
            AND lower(btrim(COALESCE(NULLIF(a.status, ''), NULLIF(a.estado, ''), '')))
                NOT IN ('anulada', 'anulado', 'cancelada', 'cancelado', 'cancelled', 'canceled', 'no acude', 'no acudió', 'no acudio', 'no_show', 'no show', 'noshow')
        ), 0), 2) AS estimated_revenue
      FROM public.doctoralia_appointments_ingestion a
      WHERE a.doctor_id IS NOT NULL
      GROUP BY a.doctor_id
    ),
    lead_agg AS (
      SELECT
        l.doctor_id,
        count(l.id)::bigint AS total_appointments,
        count(l.id) FILTER (
          WHERE l.attended_at IS NOT NULL
             OR l.appointment_status = 'showed'::public.appointment_status
        )::bigint AS attended_count,
        count(l.id) FILTER (WHERE COALESCE(l.no_show_flag, false))::bigint AS no_show_count,
        count(l.id) FILTER (
          WHERE l.appointment_status = 'cancelled'::public.appointment_status
        )::bigint AS cancelled_count,
        count(l.id) FILTER (WHERE l.appointment_date IS NOT NULL)::bigint AS confirmed_count,
        round(COALESCE(sum(COALESCE(l.revenue, 0)) FILTER (WHERE COALESCE(l.revenue, 0) > 0), 0), 2) AS estimated_revenue
      FROM public.leads l
      WHERE l.doctor_id IS NOT NULL
        AND l.deleted_at IS NULL
        AND l.merged_into_lead_id IS NULL
      GROUP BY l.doctor_id
    ),
    doctor_settlements AS (
      SELECT
        l.doctor_id,
        round(COALESCE(sum(fs.amount_net) FILTER (WHERE fs.cancelled_at IS NULL), 0), 2) AS verified_revenue
      FROM public.leads l
      JOIN public.financial_settlements fs ON fs.patient_id = l.converted_patient_id
      WHERE l.doctor_id IS NOT NULL
        AND l.deleted_at IS NULL
        AND l.merged_into_lead_id IS NULL
      GROUP BY l.doctor_id
    ),
    combined AS (
      SELECT
        d.id AS doctor_id,
        d.name AS doctor_name,
        d.specialty,
        d.is_active,
        d.clinic_id,
        COALESCE(da.total_appointments, la.total_appointments, 0)::bigint AS total_appointments,
        COALESCE(da.attended_count, la.attended_count, 0)::bigint AS attended_count,
        COALESCE(da.no_show_count, la.no_show_count, 0)::bigint AS no_show_count,
        COALESCE(da.cancelled_count, la.cancelled_count, 0)::bigint AS cancelled_count,
        COALESCE(da.confirmed_count, la.confirmed_count, 0)::bigint AS confirmed_count,
        COALESCE(da.estimated_revenue, la.estimated_revenue, 0)::numeric AS estimated_revenue,
        COALESCE(ds.verified_revenue, 0)::numeric AS verified_revenue_crm
      FROM public.doctors d
      LEFT JOIN doctoralia_agg da ON da.doctor_id = d.id
      LEFT JOIN lead_agg la ON la.doctor_id = d.id
      LEFT JOIN doctor_settlements ds ON ds.doctor_id = d.id
    )
    SELECT
      c.doctor_id,
      c.doctor_name,
      c.specialty,
      c.is_active,
      c.clinic_id,
      c.total_appointments,
      c.attended_count,
      c.no_show_count,
      c.cancelled_count,
      c.confirmed_count,
      round(
        CASE WHEN c.total_appointments > 0
          THEN 100.0 * c.attended_count::numeric / c.total_appointments::numeric
          ELSE 0::numeric END,
        2
      ) AS attended_rate_pct,
      round(
        CASE WHEN c.total_appointments > 0
          THEN 100.0 * c.no_show_count::numeric / c.total_appointments::numeric
          ELSE 0::numeric END,
        2
      ) AS no_show_rate_pct,
      c.estimated_revenue,
      c.verified_revenue_crm
    FROM combined c
  $view$;

  IF v_reloptions IS NOT NULL AND pg_catalog.array_length(v_reloptions, 1) > 0 THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_doctor_performance_real SET (%s)',
      pg_catalog.array_to_string(v_reloptions, ', ')
    );
  END IF;

  FOR v_acl IN
    SELECT * FROM nvx_doctor_pre_acl ORDER BY grantee_name, privilege_type
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT %s ON TABLE public.vw_doctor_performance_real TO %s%s',
      v_acl.privilege_type,
      CASE WHEN v_acl.grantee_name = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(v_acl.grantee_name) END,
      CASE WHEN v_acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;

  IF v_owner_name <> current_user THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_doctor_performance_real OWNER TO %I',
      v_owner_name
    );
  END IF;
END;
$doctor_order_bridge$;

COMMIT;
