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
-- snapshots dependent view definitions/options/grants/comments, rebuilds them
-- around the type conversion, and fails closed rather than using
-- DROP ... CASCADE blindly.

DO $bridge$
DECLARE
  v_udt_schema text;
  v_udt_name text;
  v_view record;
  v_acl record;
  v_comment record;
  v_historical_definition text;
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
    owner_name text NOT NULL,
    view_comment text
  ) ON COMMIT DROP;

  CREATE TEMP TABLE nvx_appointment_status_view_acl (
    view_oid oid NOT NULL,
    grantee_name text NOT NULL,
    privilege_type text NOT NULL,
    is_grantable boolean NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE nvx_appointment_status_view_column_comment (
    view_oid oid NOT NULL,
    column_name text NOT NULL,
    comment_text text NOT NULL,
    PRIMARY KEY (view_oid, column_name)
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
    owner_name,
    view_comment
  )
  SELECT v.oid,
         d.dependency_depth,
         n.nspname,
         v.relname,
         pg_catalog.pg_get_viewdef(v.oid, true),
         v.reloptions,
         pg_catalog.pg_get_userbyid(v.relowner),
         pg_catalog.obj_description(v.oid, 'pg_class')
  FROM depths d
  JOIN pg_catalog.pg_class v ON v.oid = d.view_oid
  JOIN pg_catalog.pg_namespace n ON n.oid = v.relnamespace;

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

  INSERT INTO nvx_appointment_status_view_column_comment (
    view_oid,
    column_name,
    comment_text
  )
  SELECT r.view_oid,
         a.attname,
         pg_catalog.col_description(r.view_oid, a.attnum)
  FROM nvx_appointment_status_view_restore r
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = r.view_oid
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE pg_catalog.col_description(r.view_oid, a.attnum) IS NOT NULL;

  -- The historical unified Doctoralia view exposes appointment_status as TEXT:
  -- Doctoralia's estado is text and, before this bridge, leads.appointment_status
  -- was also text. After converting the base column to the enum, replaying the
  -- captured definition verbatim would fail with SQLSTATE 42804 because
  -- COALESCE(text, appointment_status) has no common type. Keep this one public
  -- view contract as text by casting only the enum-side argument. Do not perform
  -- a generic ::text rewrite across unrelated view definitions.
  SELECT r.view_definition
    INTO v_historical_definition
  FROM nvx_appointment_status_view_restore r
  WHERE r.view_schema = 'public'
    AND r.view_name = 'vw_doctoralia_lead_traceability_unified';

  IF FOUND THEN
    IF pg_catalog.strpos(
      v_historical_definition,
      'COALESCE(dr.estado::text, l.appointment_status)'
    ) = 0 THEN
      RAISE EXCEPTION
        'Historical vw_doctoralia_lead_traceability_unified definition changed: expected appointment_status text COALESCE boundary is missing';
    END IF;

    UPDATE nvx_appointment_status_view_restore r
    SET view_definition = pg_catalog.replace(
      r.view_definition,
      'COALESCE(dr.estado::text, l.appointment_status)',
      'COALESCE(dr.estado::text, l.appointment_status::text)'
    )
    WHERE r.view_schema = 'public'
      AND r.view_name = 'vw_doctoralia_lead_traceability_unified';

    IF EXISTS (
      SELECT 1
      FROM nvx_appointment_status_view_restore r
      WHERE r.view_schema = 'public'
        AND r.view_name = 'vw_doctoralia_lead_traceability_unified'
        AND pg_catalog.strpos(
          r.view_definition,
          'COALESCE(dr.estado::text, l.appointment_status::text)'
        ) = 0
    ) THEN
      RAISE EXCEPTION 'Failed to make historical unified Doctoralia view enum-replay-safe';
    END IF;
  END IF;

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
    EXECUTE pg_catalog.format(
      'CREATE VIEW %I.%I AS %s',
      v_view.view_schema,
      v_view.view_name,
      v_view.view_definition
    );

    IF v_view.reloptions IS NOT NULL AND pg_catalog.array_length(v_view.reloptions, 1) > 0 THEN
      EXECUTE pg_catalog.format(
        'ALTER VIEW %I.%I SET (%s)',
        v_view.view_schema,
        v_view.view_name,
        pg_catalog.array_to_string(v_view.reloptions, ', ')
      );
    END IF;

    IF v_view.view_comment IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'COMMENT ON VIEW %I.%I IS %L',
        v_view.view_schema,
        v_view.view_name,
        v_view.view_comment
      );
    END IF;

    FOR v_comment IN
      SELECT *
      FROM nvx_appointment_status_view_column_comment c
      WHERE c.view_oid = v_view.view_oid
      ORDER BY c.column_name
    LOOP
      EXECUTE pg_catalog.format(
        'COMMENT ON COLUMN %I.%I.%I IS %L',
        v_view.view_schema,
        v_view.view_name,
        v_comment.column_name,
        v_comment.comment_text
      );
    END LOOP;

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
