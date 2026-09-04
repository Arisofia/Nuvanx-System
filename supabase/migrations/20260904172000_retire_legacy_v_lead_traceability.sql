-- Retire the Production-only public.v_lead_traceability shadow view.
--
-- public.vw_lead_traceability is the versioned runtime contract. The legacy
-- public.v_lead_traceability object is not present on clean replay, has no
-- repository consumer, and inherited broad default privileges in Production.
--
-- This migration deliberately does not use CASCADE. If the live object drifts
-- from the audited legacy signature/security state or gains a dependent object,
-- the migration aborts before mutation.

DO $retire_legacy_v_lead_traceability$
DECLARE
  v_legacy_oid oid;
  v_legacy_signature text;
  v_legacy_owner text;
  v_legacy_reloptions text[];
  v_legacy_comment text;
  v_has_column_acl boolean;
  v_legacy_acl text[];
  v_external_dependents integer;
  v_canonical_signature text;
  v_canonical_owner text;
  v_canonical_reloptions text[];

  v_expected_legacy_signature constant text := E'1:id:uuid\n2:name:character varying(255)\n3:email_normalized:character varying(255)\n4:phone_normalized:character varying(20)\n5:source:character varying(64)\n6:stage:character varying(64)\n7:no_show_flag:boolean\n8:attended_at:timestamp with time zone\n9:appointment_status:appointment_status\n10:lost_reason:lost_reason\n11:first_outbound_at:timestamp with time zone\n12:first_inbound_at:timestamp with time zone\n13:reply_delay_minutes:integer\n14:campaign_id:character varying(64)\n15:campaign_name:character varying(255)\n16:adset_id:character varying(64)\n17:ad_id:character varying(64)\n18:verified_revenue:numeric(12,2)\n19:created_at:timestamp with time zone\n20:doctoralia_net:numeric(12,2)\n21:financing_template:character varying(255)\n22:settlement_date:timestamp with time zone\n23:settlement_cancelled_at:timestamp with time zone\n24:total_ltv:numeric(12,2)';

  v_expected_canonical_signature constant text := E'1:lead_id:uuid\n2:lead_name:character varying(255)\n3:email_normalized:text\n4:phone_normalized:character varying(20)\n5:source:character varying(64)\n6:stage:text\n7:campaign_id:character varying(64)\n8:campaign_name:character varying(255)\n9:adset_id:character varying(64)\n10:adset_name:character varying(255)\n11:ad_id:character varying(64)\n12:ad_name:character varying(255)\n13:form_id:character varying(64)\n14:form_name:character varying(255)\n15:lead_created_at:timestamp with time zone\n16:first_outbound_at:timestamp with time zone\n17:first_inbound_at:timestamp with time zone\n18:reply_delay_minutes:integer\n19:appointment_status:appointment_status\n20:attended_at:timestamp with time zone\n21:no_show_flag:boolean\n22:estimated_revenue:numeric(12,2)\n23:crm_verified_revenue:numeric(12,2)\n24:lost_reason:text\n25:patient_id:uuid\n26:patient_ltv:numeric(12,2)\n27:settlement_id:text\n28:doctoralia_template_id:character varying(32)\n29:doctoralia_template_name:character varying(255)\n30:doctoralia_net:numeric(12,2)\n31:doctoralia_gross:numeric(12,2)\n32:settlement_date:timestamp with time zone\n33:settlement_intake_date:timestamp with time zone\n34:settlement_source:text\n35:lead_user_id:uuid\n36:patient_name:text\n37:patient_dni:text\n38:patient_phone:character varying(64)\n39:patient_last_visit:timestamp with time zone\n40:doc_patient_id:text\n41:match_confidence:numeric\n42:match_class:character varying(32)\n43:first_settlement_at:timestamp with time zone';

  -- Audited Production ACL identity on 2026-09-04. Grantee, grantor,
  -- privilege, and grantability are all part of the fail-closed contract.
  -- PUBLIC is intentionally absent; an explicit PUBLIC entry is drift.
  v_expected_legacy_acl constant text[] := ARRAY[
    'anon:postgres:DELETE:plain',
    'anon:postgres:INSERT:plain',
    'anon:postgres:MAINTAIN:plain',
    'anon:postgres:REFERENCES:plain',
    'anon:postgres:SELECT:plain',
    'anon:postgres:TRIGGER:plain',
    'anon:postgres:TRUNCATE:plain',
    'anon:postgres:UPDATE:plain',
    'authenticated:postgres:DELETE:plain',
    'authenticated:postgres:INSERT:plain',
    'authenticated:postgres:MAINTAIN:plain',
    'authenticated:postgres:REFERENCES:plain',
    'authenticated:postgres:SELECT:plain',
    'authenticated:postgres:TRIGGER:plain',
    'authenticated:postgres:TRUNCATE:plain',
    'authenticated:postgres:UPDATE:plain',
    'postgres:postgres:DELETE:plain',
    'postgres:postgres:INSERT:plain',
    'postgres:postgres:MAINTAIN:plain',
    'postgres:postgres:REFERENCES:plain',
    'postgres:postgres:SELECT:plain',
    'postgres:postgres:TRIGGER:plain',
    'postgres:postgres:TRUNCATE:plain',
    'postgres:postgres:UPDATE:plain',
    'service_role:postgres:DELETE:plain',
    'service_role:postgres:INSERT:plain',
    'service_role:postgres:MAINTAIN:plain',
    'service_role:postgres:REFERENCES:plain',
    'service_role:postgres:SELECT:plain',
    'service_role:postgres:TRIGGER:plain',
    'service_role:postgres:TRUNCATE:plain',
    'service_role:postgres:UPDATE:plain'
  ];
BEGIN
  v_legacy_oid := to_regclass('public.v_lead_traceability');

  -- Clean Preview/replay never had this Production-only shadow object.
  IF v_legacy_oid IS NULL THEN
    RAISE NOTICE 'public.v_lead_traceability absent; retirement is a no-op';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = v_legacy_oid
      AND n.nspname = 'public'
      AND c.relname = 'v_lead_traceability'
      AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'public.v_lead_traceability exists but is not the audited ordinary view';
  END IF;

  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
    RAISE EXCEPTION 'canonical public.vw_lead_traceability is required before legacy retirement';
  END IF;

  SELECT
    string_agg(format('%s:%s:%s', a.attnum, a.attname, format_type(a.atttypid, a.atttypmod)), E'\n' ORDER BY a.attnum),
    bool_or(a.attacl IS NOT NULL)
  INTO v_legacy_signature, v_has_column_acl
  FROM pg_attribute a
  WHERE a.attrelid = v_legacy_oid
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_legacy_signature IS DISTINCT FROM v_expected_legacy_signature THEN
    RAISE EXCEPTION 'Unexpected public.v_lead_traceability signature; refusing legacy retirement';
  END IF;

  SELECT pg_get_userbyid(c.relowner), c.reloptions, obj_description(c.oid, 'pg_class')
  INTO v_legacy_owner, v_legacy_reloptions, v_legacy_comment
  FROM pg_class c
  WHERE c.oid = v_legacy_oid;

  IF v_legacy_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Unexpected public.v_lead_traceability owner: %', v_legacy_owner;
  END IF;

  IF COALESCE(v_legacy_reloptions, ARRAY[]::text[]) IS DISTINCT FROM ARRAY['security_invoker=true']::text[] THEN
    RAISE EXCEPTION 'Unexpected public.v_lead_traceability reloptions: %', v_legacy_reloptions;
  END IF;

  IF v_legacy_comment IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected public.v_lead_traceability comment; refusing retirement';
  END IF;

  IF COALESCE(v_has_column_acl, false) THEN
    RAISE EXCEPTION 'Unexpected column ACL on public.v_lead_traceability; refusing retirement';
  END IF;

  SELECT array_agg(
    format(
      '%s:%s:%s:%s',
      CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
      pg_get_userbyid(x.grantor),
      x.privilege_type,
      CASE WHEN x.is_grantable THEN 'grantable' ELSE 'plain' END
    )
    ORDER BY
      CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
      pg_get_userbyid(x.grantor),
      x.privilege_type
  )
  INTO v_legacy_acl
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) x
  WHERE c.oid = v_legacy_oid;

  IF v_legacy_acl IS DISTINCT FROM v_expected_legacy_acl THEN
    RAISE EXCEPTION 'Unexpected public.v_lead_traceability ACL; refusing retirement';
  END IF;

  -- Fail closed if any object outside the view's own rewrite/composite type now
  -- depends on the legacy view. DROP VIEW below intentionally has no CASCADE.
  SELECT count(*)
  INTO v_external_dependents
  FROM pg_depend d
  LEFT JOIN pg_rewrite r
    ON d.classid = 'pg_rewrite'::regclass
   AND r.oid = d.objid
  WHERE d.refobjid = v_legacy_oid
    AND NOT (
      d.classid = 'pg_rewrite'::regclass
      AND r.ev_class = v_legacy_oid
      AND d.deptype = 'i'
    )
    AND NOT (
      d.classid = 'pg_type'::regclass
      AND d.deptype = 'i'
    );

  IF v_external_dependents <> 0 THEN
    RAISE EXCEPTION 'public.v_lead_traceability has % unexpected dependents; refusing retirement', v_external_dependents;
  END IF;

  SELECT
    string_agg(format('%s:%s:%s', a.attnum, a.attname, format_type(a.atttypid, a.atttypmod)), E'\n' ORDER BY a.attnum),
    pg_get_userbyid(c.relowner),
    c.reloptions
  INTO v_canonical_signature, v_canonical_owner, v_canonical_reloptions
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
    AND a.attnum > 0
    AND NOT a.attisdropped
  GROUP BY c.relowner, c.reloptions;

  IF v_canonical_signature IS DISTINCT FROM v_expected_canonical_signature THEN
    RAISE EXCEPTION 'Canonical public.vw_lead_traceability signature is not accepted; refusing legacy retirement';
  END IF;

  IF v_canonical_owner IS DISTINCT FROM 'postgres'
     OR COALESCE(v_canonical_reloptions, ARRAY[]::text[]) IS DISTINCT FROM ARRAY['security_invoker=true']::text[] THEN
    RAISE EXCEPTION 'Canonical public.vw_lead_traceability security state is not accepted';
  END IF;

  -- Close the known inherited exposure before the object is removed. Both ACL
  -- change and DROP occur atomically in this migration transaction.
  REVOKE ALL PRIVILEGES ON TABLE public.v_lead_traceability
    FROM PUBLIC, anon, authenticated, service_role;
  GRANT SELECT ON TABLE public.v_lead_traceability TO service_role;

  DROP VIEW public.v_lead_traceability;

  IF to_regclass('public.v_lead_traceability') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy public.v_lead_traceability retirement failed';
  END IF;

  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
    RAISE EXCEPTION 'Canonical public.vw_lead_traceability disappeared during legacy retirement';
  END IF;
END;
$retire_legacy_v_lead_traceability$;
