-- Forward-only reconciliation for source_to_cash clean-replay type drift.
--
-- Production already exposes the canonical public contract. Fresh replay can
-- reach the same semantic view with the exact historical signature emitted by
-- 20260831173000 after reply_delay_minutes becomes INTEGER. PostgreSQL cannot
-- change existing view output types via CREATE OR REPLACE, so only that exact
-- legacy signature may be rebuilt. Any third signature fails closed.

BEGIN;

CREATE TEMP TABLE nvx_source_to_cash_restore (
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_source_to_cash_acl (
  grantor_name text NOT NULL,
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $source_to_cash_bridge$
DECLARE
  v_signature text;
BEGIN
  IF to_regclass('public.source_to_cash') IS NULL THEN
    RETURN;
  END IF;

  SELECT string_agg(
           pg_catalog.format(
             '%s:%s:%s',
             a.attnum,
             a.attname,
             pg_catalog.format_type(a.atttypid, a.atttypmod)
           ),
           E'\n' ORDER BY a.attnum
         )
    INTO v_signature
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'source_to_cash'
    AND c.relkind = 'v'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  -- Exact canonical Production signature observed on 2026-09-02.
  IF v_signature = E'1:lead_id:uuid\n2:user_id:uuid\n3:lead_name:character varying(255)\n4:acquisition_channel:character varying(64)\n5:current_stage:text\n6:campaign_name:character varying(255)\n7:campaign_id:character varying(64)\n8:lead_created_at:timestamp with time zone\n9:first_outbound_at:timestamp with time zone\n10:first_inbound_at:timestamp with time zone\n11:reply_delay_minutes:integer\n12:attended_at:timestamp with time zone\n13:no_show_flag:boolean\n14:crm_revenue:numeric(12,2)\n15:verified_revenue:numeric(12,2)\n16:patient_id:text\n17:patient_name:character varying\n18:doctoralia_ltv:numeric(12,2)\n19:settled_amount:numeric(12,2)\n20:financing_template:character varying(255)\n21:settled_at:timestamp with time zone\n22:matched_to_doctoralia:boolean\n23:effective_revenue:numeric' THEN
    RETURN;
  END IF;

  -- Exact historical replay signature measured from the 20260831173000 view
  -- definition against the pre-092000 source-table types.
  IF v_signature IS DISTINCT FROM E'1:lead_id:uuid\n2:user_id:uuid\n3:lead_name:text\n4:acquisition_channel:text\n5:current_stage:text\n6:campaign_name:text\n7:campaign_id:text\n8:lead_created_at:timestamp with time zone\n9:first_outbound_at:timestamp with time zone\n10:first_inbound_at:timestamp with time zone\n11:reply_delay_minutes:integer\n12:attended_at:timestamp with time zone\n13:no_show_flag:boolean\n14:crm_revenue:numeric(12,2)\n15:verified_revenue:numeric(12,2)\n16:patient_id:text\n17:patient_name:text\n18:doctoralia_ltv:numeric(14,2)\n19:settled_amount:numeric(14,2)\n20:financing_template:text\n21:settled_at:timestamp with time zone\n22:matched_to_doctoralia:boolean\n23:effective_revenue:numeric' THEN
    RAISE EXCEPTION 'Unexpected source_to_cash signature:%', E'\n' || coalesce(v_signature, '<missing>');
  END IF;

  -- CREATE OR REPLACE cannot safely preserve dependent objects through a type
  -- change. No CASCADE is used: any dependent view/materialized view blocks the
  -- reconciliation instead of being silently dropped.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class parent
    JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
    JOIN pg_catalog.pg_depend d ON d.refobjid = parent.oid
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class child ON child.oid = r.ev_class
    WHERE pn.nspname = 'public'
      AND parent.relname = 'source_to_cash'
      AND parent.relkind = 'v'
      AND child.oid <> parent.oid
      AND child.relkind IN ('v', 'm')
  ) THEN
    RAISE EXCEPTION 'Cannot rebuild legacy source_to_cash: dependent view exists';
  END IF;

  -- Production contract has no column-level ACLs on source_to_cash. A rebuild
  -- cannot preserve pg_attribute.attacl with the relation-level ACL restore
  -- below, so fail closed before DROP if any appear.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'source_to_cash'
      AND c.relkind = 'v'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile source_to_cash: column-level ACLs detected (not supported by Production contract)';
  END IF;

  -- Explicit text -> varchar(n) casts may truncate in PostgreSQL. Refuse the
  -- rebuild instead of losing characters.
  IF EXISTS (
    SELECT 1 FROM public.leads l
    WHERE (l.name IS NOT NULL AND char_length(l.name) > 255)
       OR (l.source IS NOT NULL AND char_length(l.source) > 64)
       OR (l.campaign_name IS NOT NULL AND char_length(l.campaign_name) > 255)
       OR (l.campaign_id IS NOT NULL AND char_length(l.campaign_id) > 64)
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile source_to_cash: lead text exceeds canonical varchar bounds';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.financial_settlements fs
    WHERE fs.template_name IS NOT NULL
      AND char_length(fs.template_name) > 255
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile source_to_cash: financing template exceeds varchar(255)';
  END IF;

  -- numeric(12,2) supports absolute values strictly below 10^10. The source
  -- columns are numeric(14,2), so guard before narrowing.
  IF EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.total_ltv IS NOT NULL
      AND pg_catalog.abs(p.total_ltv) >= 10000000000::numeric
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile source_to_cash: patients.total_ltv exceeds numeric(12,2) range';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.financial_settlements fs
    WHERE fs.amount_net IS NOT NULL
      AND pg_catalog.abs(fs.amount_net) >= 10000000000::numeric
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile source_to_cash: financial_settlements.amount_net exceeds numeric(12,2) range';
  END IF;

  INSERT INTO nvx_source_to_cash_restore (reloptions, owner_name)
  SELECT c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'source_to_cash'
    AND c.relkind = 'v';

  INSERT INTO nvx_source_to_cash_acl (
    grantor_name,
    grantee_name,
    privilege_type,
    is_grantable
  )
  SELECT
    pg_catalog.pg_get_userbyid(acl.grantor),
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE n.nspname = 'public'
    AND c.relname = 'source_to_cash'
    AND c.relkind = 'v'
    AND c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  IF EXISTS (
    SELECT 1
    FROM nvx_source_to_cash_acl
    WHERE grantor_name IS DISTINCT FROM current_user
  ) THEN
    RAISE EXCEPTION
      'Cannot reproduce source_to_cash ACL grantors as current_user=%',
      current_user;
  END IF;

  DROP VIEW public.source_to_cash;
END;
$source_to_cash_bridge$;

CREATE OR REPLACE VIEW public.source_to_cash
WITH (security_invoker = true)
AS
WITH dai_ranked AS (
  SELECT DISTINCT ON (dai.phone_normalized)
    dai.phone_normalized,
    dai.doctoralia_id,
    dai.patient_name     AS dai_patient_name,
    dai.funnel_stage     AS dai_funnel_stage,
    dai.estado           AS dai_estado,
    dai.amount           AS dai_amount,
    dai.appointment_date AS dai_appointment_date
  FROM public.doctoralia_appointments_ingestion dai
  WHERE dai.phone_normalized IS NOT NULL
  ORDER BY
    dai.phone_normalized,
    dai.appointment_date DESC NULLS LAST,
    dai.amount DESC NULLS LAST,
    dai.id
)
SELECT
  l.id AS lead_id,
  l.user_id,
  l.name::character varying(255) AS lead_name,
  l.source::character varying(64) AS acquisition_channel,
  COALESCE(l.stage_canonical, l.stage)::text AS current_stage,
  l.campaign_name::character varying(255) AS campaign_name,
  l.campaign_id::character varying(64) AS campaign_id,
  l.created_at AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes::integer AS reply_delay_minutes,
  l.attended_at,
  l.no_show_flag,
  l.revenue::numeric(12,2) AS crm_revenue,
  l.verified_revenue::numeric(12,2) AS verified_revenue,
  COALESCE(
    p.id::text,
    NULLIF(pg_catalog.btrim(dai.doctoralia_id), ''),
    dai.phone_normalized
  )::text AS patient_id,
  COALESCE(p.name::text, dai.dai_patient_name::text)::character varying AS patient_name,
  p.total_ltv::numeric(12,2) AS doctoralia_ltv,
  fs.amount_net::numeric(12,2) AS settled_amount,
  fs.template_name::character varying(255) AS financing_template,
  fs.settled_at,
  (p.id IS NOT NULL OR dai.phone_normalized IS NOT NULL) AS matched_to_doctoralia,
  COALESCE(fs.amount_net, l.verified_revenue, l.revenue, 0::numeric)::numeric AS effective_revenue
FROM public.leads l
LEFT JOIN public.patients p
  ON  p.dni_hash::text = l.dni_hash::text
  OR  (p.phone_normalized IS NOT NULL
       AND p.phone_normalized::text = l.phone_normalized::text)
  OR  (p.email_normalized IS NOT NULL
       AND p.email_normalized::text = l.email_normalized::text)
LEFT JOIN dai_ranked dai
  ON p.id IS NULL
 AND dai.phone_normalized::text = l.phone_normalized::text
LEFT JOIN public.financial_settlements fs
  ON fs.patient_id = p.id
WHERE l.deleted_at IS NULL;

DO $source_to_cash_restore$
DECLARE
  v_restore record;
  v_acl record;
  v_safe_reloptions text[];
BEGIN
  SELECT * INTO v_restore FROM nvx_source_to_cash_restore LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Preserve every historical view option except security_invoker. The
  -- canonical contract is always invoker-security, regardless of replay input.
  SELECT pg_catalog.array_agg(opt)
    INTO v_safe_reloptions
  FROM pg_catalog.unnest(COALESCE(v_restore.reloptions, ARRAY[]::text[])) AS opt
  WHERE opt !~ '^security_invoker=';

  IF v_safe_reloptions IS NOT NULL
     AND pg_catalog.array_length(v_safe_reloptions, 1) > 0 THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.source_to_cash SET (%s)',
      pg_catalog.array_to_string(v_safe_reloptions, ', ')
    );
  END IF;

  ALTER VIEW public.source_to_cash SET (security_invoker = true);

  FOR v_acl IN
    SELECT *
    FROM nvx_source_to_cash_acl
    ORDER BY grantee_name, privilege_type
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT %s ON TABLE public.source_to_cash TO %s%s',
      v_acl.privilege_type,
      CASE WHEN v_acl.grantee_name = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(v_acl.grantee_name) END,
      CASE WHEN v_acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;

  IF v_restore.owner_name <> current_user THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.source_to_cash OWNER TO %I',
      v_restore.owner_name
    );
  END IF;
END;
$source_to_cash_restore$;

COMMENT ON VIEW public.source_to_cash IS
  'Canonical lead-to-cash view: active leads only, deterministic DAI matching, stable Doctoralia identity, Production-compatible public types.';

COMMIT;
