-- Clean-replay reconciliation for public.leads.reply_delay_minutes.
--
-- Production already uses INTEGER and must be a schema no-op. Historical clean
-- replay can reach this point with NUMERIC, which leaks into source_to_cash and
-- diverges from the canonical Production contract. Reconcile only that exact
-- drift, fail closed on fractional/out-of-range data, and rebuild only the
-- directly/transitively dependent views observed in clean replay.

BEGIN;

CREATE TEMP TABLE nvx_reply_delay_view_restore (
  view_oid oid PRIMARY KEY,
  dependency_depth integer NOT NULL,
  view_schema text NOT NULL,
  view_name text NOT NULL,
  view_definition text NOT NULL,
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_reply_delay_view_acl (
  view_oid oid NOT NULL,
  grantor_name text NOT NULL,
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $reply_delay_bridge$
DECLARE
  v_data_type text;
  v_udt_name text;
  v_default text;
  v_nullable text;
  v_dependent_views text[];
  v_view record;
  v_acl record;
  v_safe_reloptions text[];
BEGIN
  IF to_regclass('public.leads') IS NULL THEN
    RAISE EXCEPTION 'public.leads is required before reply-delay reconciliation';
  END IF;

  SELECT c.data_type, c.udt_name, c.column_default, c.is_nullable
    INTO v_data_type, v_udt_name, v_default, v_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'leads'
    AND c.column_name = 'reply_delay_minutes';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.leads.reply_delay_minutes is missing';
  END IF;

  -- Canonical Production signature: migration ledger advances, schema does not.
  IF v_data_type = 'integer' AND v_udt_name = 'int4' THEN
    RETURN;
  END IF;

  -- Only the observed historical clean-replay shape may be repaired here.
  IF NOT (
    v_data_type = 'numeric'
    AND v_udt_name = 'numeric'
    AND v_default IS NULL
    AND v_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION
      'Unexpected public.leads.reply_delay_minutes contract: data_type=%, udt=%, default=%, nullable=%',
      v_data_type, v_udt_name, v_default, v_nullable;
  END IF;

  -- INTEGER conversion is lossless only for integral int4-range values.
  IF EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.reply_delay_minutes IS NOT NULL
      AND (
        l.reply_delay_minutes <> trunc(l.reply_delay_minutes)
        OR l.reply_delay_minutes < -2147483648::numeric
        OR l.reply_delay_minutes > 2147483647::numeric
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot reconcile reply_delay_minutes to integer: fractional or out-of-range value exists';
  END IF;

  WITH RECURSIVE target AS (
    SELECT c.oid AS relid, a.attnum
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'leads'
      AND a.attname = 'reply_delay_minutes'
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
  INSERT INTO nvx_reply_delay_view_restore (
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

  SELECT array_agg(
           view_schema || '.' || view_name
           ORDER BY view_schema, view_name
         )
    INTO v_dependent_views
  FROM nvx_reply_delay_view_restore;

  IF v_dependent_views IS DISTINCT FROM ARRAY[
    'public.source_to_cash',
    'public.v_figma_campaign_kpis',
    'public.vw_campaign_performance_real',
    'public.vw_lead_traceability',
    'public.vw_source_comparison'
  ]::text[] THEN
    RAISE EXCEPTION
      'Unexpected reply_delay_minutes dependent views during clean replay: %',
      v_dependent_views;
  END IF;

  INSERT INTO nvx_reply_delay_view_acl (
    view_oid,
    grantor_name,
    grantee_name,
    privilege_type,
    is_grantable
  )
  SELECT r.view_oid,
         pg_catalog.pg_get_userbyid(acl.grantor),
         CASE
           WHEN acl.grantee = 0 THEN 'PUBLIC'
           ELSE pg_catalog.pg_get_userbyid(acl.grantee)
         END,
         acl.privilege_type,
         acl.is_grantable
  FROM nvx_reply_delay_view_restore r
  JOIN pg_catalog.pg_class c ON c.oid = r.view_oid
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  -- GRANT executes as current_user. Refuse to rebuild a view if that would
  -- silently change the grantor identity of an existing ACL entry.
  IF EXISTS (
    SELECT 1
    FROM nvx_reply_delay_view_acl
    WHERE grantor_name IS DISTINCT FROM current_user
  ) THEN
    RAISE EXCEPTION
      'Cannot reproduce reply-delay view ACL grantors as current_user=%',
      current_user;
  END IF;

  -- Downstream first. No CASCADE: an uncaptured dependency must fail explicitly.
  FOR v_view IN
    SELECT *
    FROM nvx_reply_delay_view_restore
    ORDER BY dependency_depth DESC, view_schema, view_name
  LOOP
    EXECUTE pg_catalog.format(
      'DROP VIEW %I.%I',
      v_view.view_schema,
      v_view.view_name
    );
  END LOOP;

  ALTER TABLE public.leads
    ALTER COLUMN reply_delay_minutes TYPE integer
    USING reply_delay_minutes::integer;

  -- Base views first, then transitive dependants. Definitions are the exact
  -- pre-conversion definitions; only the underlying canonical column type moves
  -- from NUMERIC to INTEGER.
  FOR v_view IN
    SELECT *
    FROM nvx_reply_delay_view_restore
    ORDER BY dependency_depth ASC, view_schema, view_name
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE VIEW %I.%I AS %s',
      v_view.view_schema,
      v_view.view_name,
      v_view.view_definition
    );

    -- All five known reply-delay dependants are security-invoker views in the
    -- canonical Production contract. Preserve every other option, but never
    -- inherit a historical security_invoker=false value.
    SELECT pg_catalog.array_agg(opt)
      INTO v_safe_reloptions
    FROM pg_catalog.unnest(COALESCE(v_view.reloptions, ARRAY[]::text[])) AS opt
    WHERE opt !~ '^security_invoker=';

    IF v_safe_reloptions IS NOT NULL
       AND pg_catalog.array_length(v_safe_reloptions, 1) > 0 THEN
      EXECUTE pg_catalog.format(
        'ALTER VIEW %I.%I SET (%s)',
        v_view.view_schema,
        v_view.view_name,
        pg_catalog.array_to_string(v_safe_reloptions, ', ')
      );
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER VIEW %I.%I SET (security_invoker = true)',
      v_view.view_schema,
      v_view.view_name
    );

    FOR v_acl IN
      SELECT *
      FROM nvx_reply_delay_view_acl a
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
END;
$reply_delay_bridge$;

COMMIT;
