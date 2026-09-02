-- Forward-only security and metadata reconciliation for the applied
-- 20260902173941 hotfix.
--
-- The applied hotfix rebuilt vw_lead_traceability and granted ALL privileges to
-- anon/authenticated/service_role. It also dropped the canonical view comment.
-- Repository history before that hotfix grants only SELECT to authenticated and
-- service_role and defines the canonical comment below. Accept only the exact
-- canonical view signature plus the canonical or observed-hotfix ACL/comment
-- states.

BEGIN;

DO $lead_traceability_acl$
DECLARE
  v_signature text;
  v_reloptions text[];
  v_owner_name text;
  v_view_comment text;
  v_acl text[];
  v_canonical_comment constant text :=
    'Lead audit traceability restricted to active, unmerged leads while preserving the Production public column contract.';
  v_canonical_acl constant text[] := ARRAY[
    'authenticated:SELECT:plain',
    'service_role:SELECT:plain'
  ]::text[];
  v_hotfix_acl constant text[] := ARRAY[
    'anon:DELETE:plain',
    'anon:INSERT:plain',
    'anon:MAINTAIN:plain',
    'anon:REFERENCES:plain',
    'anon:SELECT:plain',
    'anon:TRIGGER:plain',
    'anon:TRUNCATE:plain',
    'anon:UPDATE:plain',
    'authenticated:DELETE:plain',
    'authenticated:INSERT:plain',
    'authenticated:MAINTAIN:plain',
    'authenticated:REFERENCES:plain',
    'authenticated:SELECT:plain',
    'authenticated:TRIGGER:plain',
    'authenticated:TRUNCATE:plain',
    'authenticated:UPDATE:plain',
    'service_role:DELETE:plain',
    'service_role:INSERT:plain',
    'service_role:MAINTAIN:plain',
    'service_role:REFERENCES:plain',
    'service_role:SELECT:plain',
    'service_role:TRIGGER:plain',
    'service_role:TRUNCATE:plain',
    'service_role:UPDATE:plain'
  ]::text[];
BEGIN
  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
    RAISE EXCEPTION 'public.vw_lead_traceability is required for ACL reconciliation';
  END IF;

  SELECT string_agg(
           pg_catalog.format('%s:%s:%s', a.attnum, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)),
           E'\n' ORDER BY a.attnum
         ),
         c.reloptions,
         pg_catalog.pg_get_userbyid(c.relowner),
         pg_catalog.obj_description(c.oid, 'pg_class')
    INTO v_signature, v_reloptions, v_owner_name, v_view_comment
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE n.nspname = 'public' AND c.relname = 'vw_lead_traceability' AND c.relkind = 'v'
  GROUP BY c.oid, c.reloptions, c.relowner;

  IF v_signature IS DISTINCT FROM E'1:lead_id:uuid\n2:lead_name:character varying(255)\n3:email_normalized:text\n4:phone_normalized:character varying(20)\n5:source:character varying(64)\n6:stage:text\n7:campaign_id:character varying(64)\n8:campaign_name:character varying(255)\n9:adset_id:character varying(64)\n10:adset_name:character varying(255)\n11:ad_id:character varying(64)\n12:ad_name:character varying(255)\n13:form_id:character varying(64)\n14:form_name:character varying(255)\n15:lead_created_at:timestamp with time zone\n16:first_outbound_at:timestamp with time zone\n17:first_inbound_at:timestamp with time zone\n18:reply_delay_minutes:integer\n19:appointment_status:appointment_status\n20:attended_at:timestamp with time zone\n21:no_show_flag:boolean\n22:estimated_revenue:numeric(12,2)\n23:crm_verified_revenue:numeric(12,2)\n24:lost_reason:text\n25:patient_id:uuid\n26:patient_ltv:numeric(12,2)\n27:settlement_id:text\n28:doctoralia_template_id:character varying(32)\n29:doctoralia_template_name:character varying(255)\n30:doctoralia_net:numeric(12,2)\n31:doctoralia_gross:numeric(12,2)\n32:settlement_date:timestamp with time zone\n33:settlement_intake_date:timestamp with time zone\n34:settlement_source:text\n35:lead_user_id:uuid\n36:patient_name:text\n37:patient_dni:text\n38:patient_phone:character varying(64)\n39:patient_last_visit:timestamp with time zone\n40:doc_patient_id:text\n41:match_confidence:numeric\n42:match_class:character varying(32)\n43:first_settlement_at:timestamp with time zone' THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability signature before ACL reconciliation:%', E'\n' || coalesce(v_signature, '<missing>');
  END IF;
  IF v_owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability owner: %', v_owner_name;
  END IF;
  IF NOT ('security_invoker=true' = ANY(COALESCE(v_reloptions, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'vw_lead_traceability must remain security_invoker=true before ACL reconciliation';
  END IF;
  IF v_view_comment IS NOT NULL AND v_view_comment IS DISTINCT FROM v_canonical_comment THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability comment before reconciliation: %', v_view_comment;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.vw_lead_traceability'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_lead_traceability ACL: column-level ACLs detected';
  END IF;

  SELECT pg_catalog.array_agg(
           pg_catalog.format('%s:%s:%s',
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
             acl.privilege_type,
             CASE WHEN acl.is_grantable THEN 'grantable' ELSE 'plain' END)
           ORDER BY CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
                    acl.privilege_type, acl.is_grantable)
    INTO v_acl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE n.nspname = 'public' AND c.relname = 'vw_lead_traceability' AND c.relkind = 'v'
    AND c.relacl IS NOT NULL AND acl.grantee <> c.relowner;

  IF v_acl IS DISTINCT FROM v_canonical_acl AND v_acl IS DISTINCT FROM v_hotfix_acl THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability ACL before reconciliation: %', v_acl;
  END IF;

  IF v_acl = v_hotfix_acl THEN
    REVOKE ALL PRIVILEGES ON TABLE public.vw_lead_traceability
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT ON TABLE public.vw_lead_traceability TO authenticated, service_role;
  END IF;

  IF v_view_comment IS NULL THEN
    COMMENT ON VIEW public.vw_lead_traceability IS
      'Lead audit traceability restricted to active, unmerged leads while preserving the Production public column contract.';
  END IF;
END;
$lead_traceability_acl$;

COMMIT;
