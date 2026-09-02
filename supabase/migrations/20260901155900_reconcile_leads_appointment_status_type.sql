-- Clean-replay bridge for public.leads.appointment_status.
--
-- Historical Production already carries public.leads.appointment_status as the
-- canonical public.appointment_status enum. Fresh Supabase Preview databases,
-- however, replay 20260501090000_create_leads_table.sql, which creates the
-- column as TEXT. Later reporting migrations compare that column to the enum.
--
-- This migration is intentionally ordered immediately before
-- 20260901160000_fix_reporting_canonical_sources.sql. It is idempotent and a
-- no-op when the column is already the canonical enum. On a clean replay it
-- snapshots the exact known dependent views/options/grants, rebuilds them around
-- the type conversion, and fails closed rather than using DROP ... CASCADE.
--
-- One historical view needs an explicit compatibility rewrite:
-- vw_doctoralia_lead_traceability_unified coalesces dr.estado::text with
-- leads.appointment_status. Once the latter becomes the enum, that operand is
-- cast to text so the public view contract remains text and replay can continue.

DO $bridge$
DECLARE
  v_udt_schema text;
  v_udt_name text;
  v_view record;
  v_acl record;
  v_definition text;
  v_dependent_views text[];
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

  -- Production already has the canonical enum. Never mutate its views here.
  IF v_udt_schema = 'public' AND v_udt_name = 'appointment_status' THEN
    RETURN;
  END IF;

  IF NOT (v_udt_schema = 'pg_catalog' AND v_udt_name = 'text') THEN
    RAISE EXCEPTION
      'Unexpected public.leads.appointment_status type %.%; expected pg_catalog.text or public.appointment_status',
      v_udt_schema,
      v_udt_name;
  END IF;

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

  CREATE TEMP TABLE nvx_appointment_status_view_restore (
    view_oid oid PRIMARY KEY,
    dependency_depth integer NOT NULL,
    view_schema text NOT NULL,
    view_name text NOT NULL,
    view_definition text NOT NULL,
    reloptions text[],
    owner_name text NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE nvx_appointment_status_view_acl (
    view_oid oid NOT NULL,
    grantee_name text NOT NULL,
    privilege_type text NOT NULL,
    is_grantable boolean NOT NULL
  ) ON COMMIT DROP;

  WITH RECURSIVE target AS (
    SELECT c.oid AS relid, a.attnum
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'leads'
      AND a.attname = 'appointment_status'
      AND NOT a.attisdropped
  ), direct_views AS (
    SELECT v.oid AS view_oid, 0 AS dependency_depth
    FROM target t
    JOIN pg_catalog.pg_depend d
      ON d.refobjid = t.relid
     AND d.refobjsubid = t.attnum
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class v
      ON v.oid = r.ev_class
     AND v.relkind = 'v'
  ), view_graph AS (
    SELECT view_oid, dependency_depth
    FROM direct_views
    UNION ALL
    SELECT child.oid, vg.dependency_depth + 1
    FROM view_graph vg
    JOIN pg_catalog.pg_depend d ON d.refobjid = vg.view_oid
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class child
      ON child.oid = r.ev_class
     AND child.relkind = 'v'
    WHERE child.oid <> vg.view_oid
      AND vg.dependency_depth < 20
  ), depths AS (
    SELECT view_oid, max(dependency_depth) AS dependency_depth
    FROM view_graph
    GROUP BY view_oid
  )
  INSERT INTO nvx_appointment_status_view_restore (
    view_oid,
    dependency_depth,
    view_schema,
    view_name,
    view_definition,
    reloptions,
    owner_name
  )
  SELECT v.oid,
         d.dependency_depth,
         n.nspname,
         v.relname,
         pg_catalog.pg_get_viewdef(v.oid, true),
         v.reloptions,
         pg_catalog.pg_get_userbyid(v.relowner)
  FROM depths d
  JOIN pg_catalog.pg_class v ON v.oid = d.view_oid
  JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace;

  -- This is deliberately strict. If migration history changes such that another
  -- object depends on the column before this bridge, review it explicitly rather
  -- than silently rewriting/dropping an unknown object.
  SELECT array_agg(
           pg_catalog.format('%I.%I', view_schema, view_name)
           ORDER BY view_schema, view_name
         )
    INTO v_dependent_views
  FROM nvx_appointment_status_view_restore;

  IF v_dependent_views IS DISTINCT FROM ARRAY[
    'public.vw_doctoralia_patient_ltv',
    'public.vw_doctoralia_lead_traceability_unified',
    'public.vw_lead_traceability'
  ]::text[] THEN
    RAISE EXCEPTION
      'Unexpected appointment_status dependent views during clean replay: %',
      v_dependent_views;
  END IF;

  INSERT INTO nvx_appointment_status_view_acl (
    view_oid,
    grantee_name,
    privilege_type,
    is_grantable
  )
  SELECT r.view_oid,
         CASE
           WHEN acl.grantee = 0 THEN 'PUBLIC'
           ELSE pg_catalog.pg_get_userbyid(acl.grantee)
         END,
         acl.privilege_type,
         acl.is_grantable
  FROM nvx_appointment_status_view_restore r
  JOIN pg_catalog.pg_class c ON c.oid = r.view_oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  -- Drop downstream views first. No CASCADE: an uncaptured dependency must fail
  -- closed rather than silently deleting unrelated schema objects.
  FOR v_view IN
    SELECT *
    FROM nvx_appointment_status_view_restore
    ORDER BY dependency_depth DESC, view_schema, view_name
  LOOP
    EXECUTE pg_catalog.format('DROP VIEW %I.%I', v_view.view_schema, v_view.view_name);
  END LOOP;

  ALTER TABLE public.leads
    ALTER COLUMN appointment_status DROP DEFAULT;

  ALTER TABLE public.leads
    ALTER COLUMN appointment_status TYPE public.appointment_status
    USING appointment_status::public.appointment_status;

  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, public', true);

  -- Recreate base views first, then views that depend on them.
  FOR v_view IN
    SELECT *
    FROM nvx_appointment_status_view_restore
    ORDER BY dependency_depth ASC, view_schema, view_name
  LOOP
    v_definition := v_view.view_definition;

    IF v_view.view_schema = 'public'
       AND v_view.view_name = 'vw_doctoralia_lead_traceability_unified' THEN
      IF pg_catalog.strpos(v_definition, 'l.appointment_status') = 0 THEN
        RAISE EXCEPTION
          'Expected l.appointment_status reference is missing from %.% during replay',
          v_view.view_schema,
          v_view.view_name;
      END IF;

      -- Keep the historical public column contract as text while the source
      -- column becomes the enum. Avoid double-casting if replay history already
      -- contains the compatibility cast.
      IF pg_catalog.strpos(v_definition, 'l.appointment_status::text') = 0 THEN
        v_definition := pg_catalog.replace(
          v_definition,
          'l.appointment_status',
          'l.appointment_status::text'
        );
      END IF;
    END IF;

    EXECUTE pg_catalog.format(
      'CREATE VIEW %I.%I AS %s',
      v_view.view_schema,
      v_view.view_name,
      v_definition
    );

    IF v_view.reloptions IS NOT NULL AND pg_catalog.array_length(v_view.reloptions, 1) > 0 THEN
      EXECUTE pg_catalog.format(
        'ALTER VIEW %I.%I SET (%s)',
        v_view.view_schema,
        v_view.view_name,
        pg_catalog.array_to_string(v_view.reloptions, ', ')
      );
    END IF;

    FOR v_acl IN
      SELECT *
      FROM nvx_appointment_status_view_acl a
      WHERE a.view_oid = v_view.view_oid
      ORDER BY a.grantee_name, a.privilege_type
    LOOP
      EXECUTE pg_catalog.format(
        'GRANT %s ON TABLE %I.%I TO %s%s',
        v_acl.privilege_type,
        v_view.view_schema,
        v_view.view_name,
        CASE
          WHEN v_acl.grantee_name = 'PUBLIC' THEN 'PUBLIC'
          ELSE pg_catalog.quote_ident(v_acl.grantee_name)
        END,
        CASE WHEN v_acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
      );
    END LOOP;

    IF v_view.owner_name <> current_user THEN
      EXECUTE pg_catalog.format(
        'ALTER VIEW %I.%I OWNER TO %I',
        v_view.view_schema,
        v_view.view_name,
        v_view.owner_name
      );
    END IF;
  END LOOP;
END
$bridge$;