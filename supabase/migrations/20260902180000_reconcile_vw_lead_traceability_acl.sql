-- Forward-only schema/security/metadata reconciliation for the applied
-- 20260902173941 vw_lead_traceability hotfix.
--
-- The immutable applied hotfix does a DROP/CREATE from then-current source
-- columns and GRANT ALL to anon/authenticated/service_role. In Production the
-- public view signature is already canonical, but the hotfix ACL/comment drift
-- can remain. In a clean replay, the same applied hotfix deterministically
-- reintroduces the wider TEXT / NUMERIC(14,2) signature. This migration accepts
-- only those two exact states and converges both to the canonical 43-column,
-- security-invoker, SELECT-only contract.

BEGIN;

DO $lead_traceability_reconcile$
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
  v_canonical_signature constant text := E'1:lead_id:uuid\n2:lead_name:character varying(255)\n3:email_normalized:text\n4:phone_normalized:character varying(20)\n5:source:character varying(64)\n6:stage:text\n7:campaign_id:character varying(64)\n8:campaign_name:character varying(255)\n9:adset_id:character varying(64)\n10:adset_name:character varying(255)\n11:ad_id:character varying(64)\n12:ad_name:character varying(255)\n13:form_id:character varying(64)\n14:form_name:character varying(255)\n15:lead_created_at:timestamp with time zone\n16:first_outbound_at:timestamp with time zone\n17:first_inbound_at:timestamp with time zone\n18:reply_delay_minutes:integer\n19:appointment_status:appointment_status\n20:attended_at:timestamp with time zone\n21:no_show_flag:boolean\n22:estimated_revenue:numeric(12,2)\n23:crm_verified_revenue:numeric(12,2)\n24:lost_reason:text\n25:patient_id:uuid\n26:patient_ltv:numeric(12,2)\n27:settlement_id:text\n28:doctoralia_template_id:character varying(32)\n29:doctoralia_template_name:character varying(255)\n30:doctoralia_net:numeric(12,2)\n31:doctoralia_gross:numeric(12,2)\n32:settlement_date:timestamp with time zone\n33:settlement_intake_date:timestamp with time zone\n34:settlement_source:text\n35:lead_user_id:uuid\n36:patient_name:text\n37:patient_dni:text\n38:patient_phone:character varying(64)\n39:patient_last_visit:timestamp with time zone\n40:doc_patient_id:text\n41:match_confidence:numeric\n42:match_class:character varying(32)\n43:first_settlement_at:timestamp with time zone';
  v_hotfix_replay_signature constant text := E'1:lead_id:uuid\n2:lead_name:text\n3:email_normalized:text\n4:phone_normalized:text\n5:source:text\n6:stage:text\n7:campaign_id:text\n8:campaign_name:text\n9:adset_id:text\n10:adset_name:text\n11:ad_id:text\n12:ad_name:text\n13:form_id:text\n14:form_name:text\n15:lead_created_at:timestamp with time zone\n16:first_outbound_at:timestamp with time zone\n17:first_inbound_at:timestamp with time zone\n18:reply_delay_minutes:integer\n19:appointment_status:appointment_status\n20:attended_at:timestamp with time zone\n21:no_show_flag:boolean\n22:estimated_revenue:numeric(12,2)\n23:crm_verified_revenue:numeric(12,2)\n24:lost_reason:text\n25:patient_id:uuid\n26:patient_ltv:numeric(14,2)\n27:settlement_id:text\n28:doctoralia_template_id:text\n29:doctoralia_template_name:text\n30:doctoralia_net:numeric(14,2)\n31:doctoralia_gross:numeric(14,2)\n32:settlement_date:timestamp with time zone\n33:settlement_intake_date:timestamp with time zone\n34:settlement_source:text\n35:lead_user_id:uuid\n36:patient_name:text\n37:patient_dni:text\n38:patient_phone:text\n39:patient_last_visit:timestamp with time zone\n40:doc_patient_id:text\n41:match_confidence:numeric\n42:match_class:character varying(32)\n43:first_settlement_at:timestamp with time zone';
BEGIN
  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
    RAISE EXCEPTION 'public.vw_lead_traceability is required for post-hotfix reconciliation';
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
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = c.oid
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
  GROUP BY c.oid, c.reloptions, c.relowner;

  IF v_signature IS DISTINCT FROM v_canonical_signature
     AND v_signature IS DISTINCT FROM v_hotfix_replay_signature THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability signature after applied 173941:%', E'\n' || coalesce(v_signature, '<missing>');
  END IF;

  IF v_owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability owner after applied 173941: %', v_owner_name;
  END IF;

  IF v_reloptions IS DISTINCT FROM ARRAY['security_invoker=true']::text[] THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability reloptions after applied 173941: %', v_reloptions;
  END IF;

  IF v_view_comment IS NOT NULL
     AND v_view_comment IS DISTINCT FROM v_canonical_comment THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability comment after applied 173941: %', v_view_comment;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.vw_lead_traceability'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_lead_traceability: column-level ACLs detected';
  END IF;

  SELECT pg_catalog.array_agg(
           pg_catalog.format(
             '%s:%s:%s',
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
             acl.privilege_type,
             CASE WHEN acl.is_grantable THEN 'grantable' ELSE 'plain' END
           )
           ORDER BY
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
             acl.privilege_type,
             acl.is_grantable
         )
    INTO v_acl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
    AND c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  IF v_signature = v_hotfix_replay_signature THEN
    -- Clean replay of immutable 173941 must reproduce its exact broad ACL and
    -- missing comment before we are allowed to rebuild the public contract.
    IF v_acl IS DISTINCT FROM v_hotfix_acl THEN
      RAISE EXCEPTION 'Unexpected ACL on replayed 173941 view: %', v_acl;
    END IF;
    IF v_view_comment IS NOT NULL THEN
      RAISE EXCEPTION 'Replayed 173941 view unexpectedly retained a comment: %', v_view_comment;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class parent
      JOIN pg_catalog.pg_namespace pn ON pn.oid = parent.relnamespace
      JOIN pg_catalog.pg_depend d ON d.refobjid = parent.oid
      JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
      JOIN pg_catalog.pg_class child ON child.oid = r.ev_class
      WHERE pn.nspname = 'public'
        AND parent.relname = 'vw_lead_traceability'
        AND parent.relkind = 'v'
        AND child.oid <> parent.oid
        AND child.relkind IN ('v', 'm')
    ) THEN
      RAISE EXCEPTION 'Cannot rebuild replayed 173941 vw_lead_traceability: dependent view exists';
    END IF;

    -- Lossless text narrowing checks.
    IF EXISTS (
      SELECT 1 FROM public.leads l
      WHERE (l.name IS NOT NULL AND char_length(l.name) > 255)
         OR (l.phone_normalized IS NOT NULL AND char_length(l.phone_normalized) > 20)
         OR (l.source IS NOT NULL AND char_length(l.source) > 64)
         OR (l.campaign_id IS NOT NULL AND char_length(l.campaign_id) > 64)
         OR (l.campaign_name IS NOT NULL AND char_length(l.campaign_name) > 255)
         OR (l.adset_id IS NOT NULL AND char_length(l.adset_id) > 64)
         OR (l.adset_name IS NOT NULL AND char_length(l.adset_name) > 255)
         OR (l.ad_id IS NOT NULL AND char_length(l.ad_id) > 64)
         OR (l.ad_name IS NOT NULL AND char_length(l.ad_name) > 255)
         OR (l.form_id IS NOT NULL AND char_length(l.form_id) > 64)
         OR (l.form_name IS NOT NULL AND char_length(l.form_name) > 255)
    ) THEN
      RAISE EXCEPTION 'Cannot reconcile replayed 173941 view: lead text exceeds canonical varchar bounds';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.phone IS NOT NULL AND char_length(p.phone) > 64
    ) THEN
      RAISE EXCEPTION 'Cannot reconcile replayed 173941 view: patient phone exceeds varchar(64)';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.financial_settlements fs
      WHERE (fs.template_id IS NOT NULL AND char_length(fs.template_id) > 32)
         OR (fs.template_name IS NOT NULL AND char_length(fs.template_name) > 255)
    ) THEN
      RAISE EXCEPTION 'Cannot reconcile replayed 173941 view: settlement text exceeds canonical varchar bounds';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.patients p
      WHERE p.total_ltv IS NOT NULL
        AND pg_catalog.abs(p.total_ltv) >= 10000000000::numeric
    ) THEN
      RAISE EXCEPTION 'Cannot reconcile replayed 173941 view: patients.total_ltv exceeds numeric(12,2) range';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.financial_settlements fs
      WHERE (fs.amount_net IS NOT NULL AND pg_catalog.abs(fs.amount_net) >= 10000000000::numeric)
         OR (fs.amount_gross IS NOT NULL AND pg_catalog.abs(fs.amount_gross) >= 10000000000::numeric)
    ) THEN
      RAISE EXCEPTION 'Cannot reconcile replayed 173941 view: settlement amounts exceed numeric(12,2) range';
    END IF;

    DROP VIEW public.vw_lead_traceability;

    CREATE VIEW public.vw_lead_traceability
    WITH (security_invoker = true) AS
    WITH fs_latest AS (
      SELECT DISTINCT ON (fs.lead_id)
        fs.lead_id,
        fs.id,
        fs.template_id,
        fs.template_name,
        fs.amount_net,
        fs.amount_gross,
        fs.settled_at,
        fs.intake_at,
        fs.source_system
      FROM public.financial_settlements fs
      ORDER BY fs.lead_id, fs.settled_at DESC NULLS LAST, fs.created_at DESC NULLS LAST
    )
    SELECT
      l.id AS lead_id,
      l.name::character varying(255) AS lead_name,
      COALESCE(l.email, NULL::character varying)::text AS email_normalized,
      l.phone_normalized::character varying(20) AS phone_normalized,
      l.source::character varying(64) AS source,
      l.stage::text AS stage,
      l.campaign_id::character varying(64) AS campaign_id,
      l.campaign_name::character varying(255) AS campaign_name,
      l.adset_id::character varying(64) AS adset_id,
      l.adset_name::character varying(255) AS adset_name,
      l.ad_id::character varying(64) AS ad_id,
      l.ad_name::character varying(255) AS ad_name,
      l.form_id::character varying(64) AS form_id,
      l.form_name::character varying(255) AS form_name,
      l.created_at AS lead_created_at,
      l.first_outbound_at,
      l.first_inbound_at,
      l.reply_delay_minutes::integer AS reply_delay_minutes,
      l.appointment_status,
      l.attended_at,
      l.no_show_flag,
      l.revenue::numeric(12,2) AS estimated_revenue,
      l.verified_revenue::numeric(12,2) AS crm_verified_revenue,
      l.lost_reason::text AS lost_reason,
      p.id AS patient_id,
      p.total_ltv::numeric(12,2) AS patient_ltv,
      fs.id::text AS settlement_id,
      fs.template_id::character varying(32) AS doctoralia_template_id,
      fs.template_name::character varying(255) AS doctoralia_template_name,
      fs.amount_net::numeric(12,2) AS doctoralia_net,
      fs.amount_gross::numeric(12,2) AS doctoralia_gross,
      fs.settled_at AS settlement_date,
      fs.intake_at AS settlement_intake_date,
      fs.source_system::text AS settlement_source,
      l.user_id AS lead_user_id,
      p.name::text AS patient_name,
      p.dni::text AS patient_dni,
      p.phone::character varying(64) AS patient_phone,
      p.last_visit AS patient_last_visit,
      NULL::text AS doc_patient_id,
      NULL::numeric AS match_confidence,
      NULL::character varying(32) AS match_class,
      NULL::timestamptz AS first_settlement_at
    FROM public.leads l
    LEFT JOIN public.patients p ON p.id = l.converted_patient_id
    LEFT JOIN fs_latest fs ON fs.lead_id = l.id
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL;

    REVOKE ALL PRIVILEGES ON TABLE public.vw_lead_traceability
      FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT ON TABLE public.vw_lead_traceability TO authenticated, service_role;
    COMMENT ON VIEW public.vw_lead_traceability IS
      'Lead audit traceability restricted to active, unmerged leads while preserving the Production public column contract.';
  ELSE
    -- Production canonical signature: only repair the known ACL/comment drift.
    IF v_acl IS DISTINCT FROM v_canonical_acl
       AND v_acl IS DISTINCT FROM v_hotfix_acl THEN
      RAISE EXCEPTION 'Unexpected ACL on canonical vw_lead_traceability: %', v_acl;
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
  END IF;

  -- Exact postcondition: every accepted input state must converge to one public
  -- contract before this migration commits.
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
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = c.oid
   AND a.attnum > 0
   AND NOT a.attisdropped
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
  GROUP BY c.oid, c.reloptions, c.relowner;

  SELECT pg_catalog.array_agg(
           pg_catalog.format(
             '%s:%s:%s',
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
             acl.privilege_type,
             CASE WHEN acl.is_grantable THEN 'grantable' ELSE 'plain' END
           )
           ORDER BY
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(acl.grantee) END,
             acl.privilege_type,
             acl.is_grantable
         )
    INTO v_acl
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
    AND c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  IF v_signature IS DISTINCT FROM v_canonical_signature THEN
    RAISE EXCEPTION 'vw_lead_traceability signature reconciliation failed:%', E'\n' || coalesce(v_signature, '<missing>');
  END IF;
  IF v_owner_name IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'vw_lead_traceability owner reconciliation failed: %', v_owner_name;
  END IF;
  IF v_reloptions IS DISTINCT FROM ARRAY['security_invoker=true']::text[] THEN
    RAISE EXCEPTION 'vw_lead_traceability reloptions reconciliation failed: %', v_reloptions;
  END IF;
  IF v_acl IS DISTINCT FROM v_canonical_acl THEN
    RAISE EXCEPTION 'vw_lead_traceability ACL reconciliation failed: %', v_acl;
  END IF;
  IF v_view_comment IS DISTINCT FROM v_canonical_comment THEN
    RAISE EXCEPTION 'vw_lead_traceability comment reconciliation failed: %', v_view_comment;
  END IF;
END;
$lead_traceability_reconcile$;

COMMIT;
