-- Forward-only reconciliation for source_to_cash clean-replay type drift.
--
-- Production already exposes the canonical public contract. Fresh replay can
-- reach the same semantic view with broader source types (text / numeric(14,2)).
-- PostgreSQL cannot change existing view output types via CREATE OR REPLACE, so
-- the exact known replay signature is rebuilt without CASCADE and with explicit
-- casts matching Production. Any unknown signature fails closed.

BEGIN;

CREATE TEMP TABLE nvx_source_to_cash_restore (
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_source_to_cash_acl (
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $source_to_cash_bridge$
DECLARE
  v_column_count integer;
  v_lead_name_type text;
  v_lead_name_len integer;
  v_acquisition_type text;
  v_acquisition_len integer;
  v_campaign_name_type text;
  v_campaign_name_len integer;
  v_campaign_id_type text;
  v_campaign_id_len integer;
  v_reply_type text;
  v_doctoralia_ltv_precision integer;
  v_doctoralia_ltv_scale integer;
  v_settled_amount_precision integer;
  v_settled_amount_scale integer;
  v_financing_type text;
  v_financing_len integer;
  v_patient_name_type text;
  v_patient_name_len integer;
BEGIN
  IF to_regclass('public.source_to_cash') IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO v_column_count
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash';

  SELECT c.data_type, c.character_maximum_length
    INTO v_lead_name_type, v_lead_name_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'lead_name';

  SELECT c.data_type, c.character_maximum_length
    INTO v_acquisition_type, v_acquisition_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'acquisition_channel';

  SELECT c.data_type, c.character_maximum_length
    INTO v_campaign_name_type, v_campaign_name_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'campaign_name';

  SELECT c.data_type, c.character_maximum_length
    INTO v_campaign_id_type, v_campaign_id_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'campaign_id';

  SELECT c.udt_name
    INTO v_reply_type
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'reply_delay_minutes';

  SELECT c.numeric_precision, c.numeric_scale
    INTO v_doctoralia_ltv_precision, v_doctoralia_ltv_scale
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'doctoralia_ltv';

  SELECT c.numeric_precision, c.numeric_scale
    INTO v_settled_amount_precision, v_settled_amount_scale
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'settled_amount';

  SELECT c.data_type, c.character_maximum_length
    INTO v_financing_type, v_financing_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'financing_template';

  SELECT c.data_type, c.character_maximum_length
    INTO v_patient_name_type, v_patient_name_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'source_to_cash'
    AND c.column_name = 'patient_name';

  -- Canonical Production signature. CREATE OR REPLACE below is type-stable.
  IF v_column_count = 23
     AND v_lead_name_type = 'character varying' AND v_lead_name_len = 255
     AND v_acquisition_type = 'character varying' AND v_acquisition_len = 64
     AND v_campaign_name_type = 'character varying' AND v_campaign_name_len = 255
     AND v_campaign_id_type = 'character varying' AND v_campaign_id_len = 64
     AND v_reply_type = 'int4'
     AND v_doctoralia_ltv_precision = 12 AND v_doctoralia_ltv_scale = 2
     AND v_settled_amount_precision = 12 AND v_settled_amount_scale = 2
     AND v_financing_type = 'character varying' AND v_financing_len = 255
     AND v_patient_name_type = 'character varying' AND v_patient_name_len IS NULL THEN
    RETURN;
  END IF;

  -- Exact clean-replay signature observed after 20260902091000.
  IF NOT (
    v_column_count = 23
    AND v_lead_name_type = 'text' AND v_lead_name_len IS NULL
    AND v_acquisition_type = 'text' AND v_acquisition_len IS NULL
    AND v_campaign_name_type = 'text' AND v_campaign_name_len IS NULL
    AND v_campaign_id_type = 'text' AND v_campaign_id_len IS NULL
    AND v_reply_type = 'int4'
    AND v_doctoralia_ltv_precision = 14 AND v_doctoralia_ltv_scale = 2
    AND v_settled_amount_precision = 14 AND v_settled_amount_scale = 2
    AND v_financing_type = 'text' AND v_financing_len IS NULL
    AND v_patient_name_type = 'text' AND v_patient_name_len IS NULL
  ) THEN
    RAISE EXCEPTION
      'Unexpected source_to_cash signature: columns=%, lead_name=%(%), acquisition=%(%), campaign_name=%(%), campaign_id=%(%), reply=%, doctoralia_ltv=(%,%), settled_amount=(%,%), financing=%(%), patient_name=%(%)',
      v_column_count,
      v_lead_name_type, v_lead_name_len,
      v_acquisition_type, v_acquisition_len,
      v_campaign_name_type, v_campaign_name_len,
      v_campaign_id_type, v_campaign_id_len,
      v_reply_type,
      v_doctoralia_ltv_precision, v_doctoralia_ltv_scale,
      v_settled_amount_precision, v_settled_amount_scale,
      v_financing_type, v_financing_len,
      v_patient_name_type, v_patient_name_len;
  END IF;

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

  INSERT INTO nvx_source_to_cash_restore (reloptions, owner_name)
  SELECT c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'source_to_cash'
    AND c.relkind = 'v';

  INSERT INTO nvx_source_to_cash_acl (grantee_name, privilege_type, is_grantable)
  SELECT
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

  DROP VIEW public.source_to_cash;
END
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
BEGIN
  SELECT * INTO v_restore FROM nvx_source_to_cash_restore LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_restore.reloptions IS NOT NULL
     AND pg_catalog.array_length(v_restore.reloptions, 1) > 0 THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.source_to_cash SET (%s)',
      pg_catalog.array_to_string(v_restore.reloptions, ', ')
    );
  END IF;

  FOR v_acl IN SELECT * FROM nvx_source_to_cash_acl ORDER BY grantee_name, privilege_type LOOP
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
END
$source_to_cash_restore$;

COMMENT ON VIEW public.source_to_cash IS
  'Canonical lead-to-cash view: active leads only, deterministic DAI matching, stable Doctoralia identity, Production-compatible public types.';

COMMIT;
