-- Canonical reporting repair — 2026-09-01
--
-- Goals:
--   1. Campaign Performance uses tenant-scoped canonical pipeline evidence.
--   2. Source Comparison filters facts inside the requested local-time window.
--   3. Campaign ROI exposes verified revenue and only provable campaign spend.
--   4. Doctor Performance prefers Doctoralia appointment ingestion.
--   5. Lead Audit excludes soft-deleted and merged leads without rewriting history.
--
-- No synthetic leads, patients, appointments, revenue or advertising spend are created.

BEGIN;

-- ---------------------------------------------------------------------------
-- Campaign Performance
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_campaign_report(date, date, date, date);
DROP FUNCTION IF EXISTS public.get_campaign_report(uuid, date, date, date, date);

CREATE FUNCTION public.get_campaign_report(
  p_user_id uuid,
  from_date date DEFAULT NULL,
  to_date date DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS TABLE (
  campaign_name text,
  campaign_id text,
  source text,
  total_leads bigint,
  contacted bigint,
  replied bigint,
  booked bigint,
  attended bigint,
  no_shows bigint,
  closed bigint,
  closed_won bigint,
  estimated_revenue numeric,
  verified_revenue_crm numeric,
  reply_rate_pct numeric,
  replied_to_booked_pct numeric,
  lead_to_close_rate_pct numeric,
  no_show_rate_pct numeric,
  avg_reply_delay_min numeric,
  first_lead_at timestamptz,
  last_lead_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH user_context AS (
    SELECT COALESCE(c.timezone, 'UTC') AS clinic_timezone
    FROM public.users u
    LEFT JOIN public.clinics c ON c.id = u.clinic_id
    WHERE u.id = p_user_id
    LIMIT 1
  ),
  params AS (
    SELECT
      COALESCE(
        from_date,
        p_from_date,
        ((CURRENT_TIMESTAMP AT TIME ZONE uc.clinic_timezone)::date - 30)
      ) AS since_date,
      COALESCE(
        to_date,
        p_to_date,
        (CURRENT_TIMESTAMP AT TIME ZONE uc.clinic_timezone)::date
      ) AS until_date,
      uc.clinic_timezone
    FROM user_context uc
  ),
  base AS (
    SELECT
      l.id,
      l.created_at,
      l.first_outbound_at,
      l.first_response_at,
      l.first_inbound_at,
      l.reply_delay_minutes,
      l.no_show_flag,
      l.revenue,
      COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
      COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
      COALESCE(
        NULLIF(btrim(l.utm_source), ''),
        NULLIF(btrim(l.source::text), ''),
        CASE WHEN ma.lead_id IS NOT NULL THEN 'meta' ELSE 'unknown' END
      )::text AS source_resolved,
      p.journey_appointment_count,
      p.valuation_appointment_date,
      p.is_new_client,
      p.client_completed_at,
      p.verified_revenue,
      EXISTS (
        SELECT 1
        FROM public.lead_appointment_matches lam
        JOIN public.doctoralia_appointments_ingestion anchor
          ON anchor.id = lam.appointment_ingestion_id
        JOIN public.doctoralia_appointments_ingestion appt
          ON appt.appointment_date = p.valuation_appointment_date
         AND (
           (
             NULLIF(btrim(anchor.doctoralia_id), '') IS NOT NULL
             AND NULLIF(btrim(appt.doctoralia_id), '') = NULLIF(btrim(anchor.doctoralia_id), '')
           )
           OR (
             NULLIF(btrim(anchor.doctoralia_id), '') IS NULL
             AND NULLIF(btrim(anchor.phone_normalized), '') IS NOT NULL
             AND appt.phone_normalized = anchor.phone_normalized
           )
         )
        WHERE lam.lead_id = l.id
          AND lam.is_primary IS TRUE
          AND p.valuation_appointment_date IS NOT NULL
          AND NOT COALESCE(appt.is_cancelled, false)
          AND lower(btrim(COALESCE(NULLIF(appt.status, ''), NULLIF(appt.estado, ''), '')))
              IN ('pagada', 'realizada', 'showed', 'completed')
      ) AS valuation_attended
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    CROSS JOIN params x
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND l.created_at >= (x.since_date::timestamp AT TIME ZONE x.clinic_timezone)
      AND l.created_at < ((x.until_date + 1)::timestamp AT TIME ZONE x.clinic_timezone)
  )
  SELECT
    b.campaign_name,
    b.campaign_id,
    b.source_resolved AS source,
    count(DISTINCT b.id)::bigint AS total_leads,
    count(DISTINCT b.id) FILTER (
      WHERE b.first_outbound_at IS NOT NULL
         OR b.first_response_at IS NOT NULL
         OR b.first_inbound_at IS NOT NULL
    )::bigint AS contacted,
    count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::bigint AS replied,
    count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::bigint AS booked,
    count(DISTINCT b.id) FILTER (
      WHERE b.valuation_attended OR b.is_new_client
    )::bigint AS attended,
    count(DISTINCT b.id) FILTER (WHERE COALESCE(b.no_show_flag, false))::bigint AS no_shows,
    count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::bigint AS closed,
    count(DISTINCT b.id) FILTER (
      WHERE b.client_completed_at IS NOT NULL OR COALESCE(b.verified_revenue, 0) > 0
    )::bigint AS closed_won,
    round(COALESCE(sum(COALESCE(b.revenue, 0)), 0), 2) AS estimated_revenue,
    round(COALESCE(sum(COALESCE(b.verified_revenue, 0)), 0), 2) AS verified_revenue_crm,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (
          WHERE b.first_outbound_at IS NOT NULL
             OR b.first_response_at IS NOT NULL
             OR b.first_inbound_at IS NOT NULL
        ), 0)::numeric,
      2
    ) AS reply_rate_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL), 0)::numeric,
      2
    ) AS replied_to_booked_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::numeric
      / NULLIF(count(DISTINCT b.id), 0)::numeric,
      2
    ) AS lead_to_close_rate_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE COALESCE(b.no_show_flag, false))::numeric
      / NULLIF(count(DISTINCT b.id), 0)::numeric,
      2
    ) AS no_show_rate_pct,
    round(avg(b.reply_delay_minutes) FILTER (WHERE b.reply_delay_minutes IS NOT NULL)::numeric, 1) AS avg_reply_delay_min,
    min(b.created_at) AS first_lead_at,
    max(b.created_at) AS last_lead_at
  FROM base b
  GROUP BY b.campaign_name, b.campaign_id, b.source_resolved
  ORDER BY total_leads DESC, verified_revenue_crm DESC, last_lead_at DESC;
$$;

-- ---------------------------------------------------------------------------
-- Source Comparison
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_source_comparison(uuid, text, text);

CREATE FUNCTION public.get_source_comparison(
  p_user_id uuid,
  p_from text DEFAULT '',
  p_to text DEFAULT ''
)
RETURNS TABLE (
  user_id uuid,
  clinic_id uuid,
  source text,
  source_label text,
  channel_group text,
  total_leads bigint,
  contacted bigint,
  replied bigint,
  booked bigint,
  closed bigint,
  reply_rate_pct numeric,
  replied_to_booked_pct numeric,
  lead_to_close_rate_pct numeric,
  avg_reply_delay_min numeric,
  verified_revenue_crm numeric,
  first_lead_at timestamptz,
  last_lead_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH params AS (
    SELECT COALESCE(c.timezone, 'UTC') AS clinic_timezone
    FROM public.users u
    LEFT JOIN public.clinics c ON c.id = u.clinic_id
    WHERE u.id = p_user_id
    LIMIT 1
  ),
  base AS (
    SELECT
      l.id,
      l.user_id,
      l.clinic_id,
      COALESCE(NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source::text), ''), 'unknown')::text AS source_resolved,
      l.created_at,
      l.first_outbound_at,
      l.first_response_at,
      l.first_inbound_at,
      l.reply_delay_minutes,
      p.journey_appointment_count,
      p.is_new_client,
      p.verified_revenue
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    LEFT JOIN params x ON true
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND (
        p_from IS NULL OR p_from = ''
        OR l.created_at >= (p_from::date::timestamp AT TIME ZONE COALESCE(x.clinic_timezone, 'UTC'))
      )
      AND (
        p_to IS NULL OR p_to = ''
        OR l.created_at < (((p_to::date + 1)::timestamp) AT TIME ZONE COALESCE(x.clinic_timezone, 'UTC'))
      )
  )
  SELECT
    b.user_id,
    b.clinic_id,
    b.source_resolved AS source,
    CASE
      WHEN b.source_resolved IN ('meta', 'meta_leadgen', 'facebook', 'instagram') THEN 'Meta Lead Ads'
      WHEN b.source_resolved = 'doctoralia_marketing' THEN 'Doctoralia Marketing'
      WHEN b.source_resolved = 'doctoralia' THEN 'Doctoralia'
      WHEN b.source_resolved IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'Google Ads'
      ELSE initcap(replace(b.source_resolved, '_', ' '))
    END::text AS source_label,
    CASE
      WHEN b.source_resolved IN ('meta', 'meta_leadgen', 'facebook', 'instagram') THEN 'social'
      WHEN b.source_resolved IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'search'
      WHEN b.source_resolved LIKE 'doctoralia%' THEN 'marketplace'
      ELSE 'other'
    END::text AS channel_group,
    count(DISTINCT b.id)::bigint AS total_leads,
    count(DISTINCT b.id) FILTER (
      WHERE b.first_outbound_at IS NOT NULL
         OR b.first_response_at IS NOT NULL
         OR b.first_inbound_at IS NOT NULL
    )::bigint AS contacted,
    count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::bigint AS replied,
    count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::bigint AS booked,
    count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::bigint AS closed,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (
          WHERE b.first_outbound_at IS NOT NULL
             OR b.first_response_at IS NOT NULL
             OR b.first_inbound_at IS NOT NULL
        ), 0)::numeric,
      2
    ) AS reply_rate_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.journey_appointment_count >= 1)::numeric
      / NULLIF(count(DISTINCT b.id) FILTER (WHERE b.first_inbound_at IS NOT NULL), 0)::numeric,
      2
    ) AS replied_to_booked_pct,
    round(
      100.0 * count(DISTINCT b.id) FILTER (WHERE b.is_new_client)::numeric
      / NULLIF(count(DISTINCT b.id), 0)::numeric,
      2
    ) AS lead_to_close_rate_pct,
    round(avg(b.reply_delay_minutes) FILTER (WHERE b.reply_delay_minutes IS NOT NULL)::numeric, 1) AS avg_reply_delay_min,
    round(COALESCE(sum(COALESCE(b.verified_revenue, 0)), 0), 2) AS verified_revenue_crm,
    min(b.created_at) AS first_lead_at,
    max(b.created_at) AS last_lead_at
  FROM base b
  GROUP BY b.user_id, b.clinic_id, b.source_resolved
  ORDER BY total_leads DESC, verified_revenue_crm DESC;
$$;

-- ---------------------------------------------------------------------------
-- Campaign ROI
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_campaign_roi(uuid, text, text, text);

CREATE FUNCTION public.get_campaign_roi(
  p_user_id uuid,
  p_from text DEFAULT '',
  p_to text DEFAULT '',
  p_source text DEFAULT ''
)
RETURNS TABLE (
  campaign_name text,
  source text,
  month text,
  leads_count bigint,
  patients_count bigint,
  net_revenue numeric,
  spend numeric,
  cac numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH user_clinic AS (
    SELECT COALESCE(c.timezone, 'UTC') AS clinic_timezone
    FROM public.users u
    LEFT JOIN public.clinics c ON c.id = u.clinic_id
    WHERE u.id = p_user_id
    LIMIT 1
  ),
  lead_base AS (
    SELECT
      l.id AS lead_id,
      COALESCE(ma.campaign_name, l.campaign_name, 'Organic / Unknown')::text AS campaign_name,
      COALESCE(ma.campaign_id, l.campaign_id)::text AS campaign_id,
      COALESCE(NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source::text), ''), 'unknown')::text AS source,
      date_trunc('month', l.created_at AT TIME ZONE COALESCE(uc.clinic_timezone, 'UTC'))::date AS month_date,
      p.is_new_client,
      COALESCE(p.verified_revenue, 0)::numeric AS verified_revenue
    FROM public.leads l
    JOIN public.vw_control_centre_pipeline p ON p.lead_id = l.id
    LEFT JOIN public.meta_attribution ma ON ma.lead_id = l.id
    LEFT JOIN user_clinic uc ON true
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND (
        p_from IS NULL OR p_from = ''
        OR l.created_at >= (p_from::date::timestamp AT TIME ZONE COALESCE(uc.clinic_timezone, 'UTC'))
      )
      AND (
        p_to IS NULL OR p_to = ''
        OR l.created_at < (((p_to::date + 1)::timestamp) AT TIME ZONE COALESCE(uc.clinic_timezone, 'UTC'))
      )
      AND (
        p_source IS NULL OR p_source = ''
        OR COALESCE(NULLIF(btrim(l.utm_source), ''), NULLIF(btrim(l.source::text), ''), 'unknown') = p_source
      )
  ),
  lead_base_with_source AS (
    SELECT
      lb.*,
      CASE
        WHEN lb.source IN ('google', 'google_ads', 'googleads', 'adwords', 'cpc') THEN 'google'
        ELSE 'other'
      END AS source_category
    FROM lead_base lb
  ),
  lead_rollup AS (
    SELECT
      b.campaign_name,
      b.campaign_id,
      b.source,
      b.source_category,
      b.month_date,
      count(DISTINCT b.lead_id)::bigint AS leads_count,
      count(DISTINCT b.lead_id) FILTER (WHERE b.is_new_client)::bigint AS patients_count,
      round(COALESCE(sum(b.verified_revenue), 0), 2) AS net_revenue
    FROM lead_base_with_source b
    GROUP BY b.campaign_name, b.campaign_id, b.source, b.source_category, b.month_date
  ),
  google_spend AS (
    SELECT
      g.campaign_id::text AS campaign_id,
      date_trunc('month', g.date)::date AS month_date,
      round(sum(COALESCE(g.spend, 0)), 2) AS spend
    FROM public.google_ads_daily_insights g
    WHERE g.user_id = p_user_id
      AND (p_from IS NULL OR p_from = '' OR g.date >= p_from::date)
      AND (p_to IS NULL OR p_to = '' OR g.date <= p_to::date)
    GROUP BY g.campaign_id, date_trunc('month', g.date)::date
  )
  SELECT
    r.campaign_name,
    r.source,
    to_char(r.month_date, 'YYYY-MM') AS month,
    r.leads_count,
    r.patients_count,
    r.net_revenue,
    CASE
      WHEN r.source_category = 'google'
       AND r.campaign_id IS NOT NULL
       AND gs.campaign_id IS NOT NULL
      THEN gs.spend
      ELSE NULL::numeric
    END AS spend,
    CASE
      WHEN r.source_category = 'google'
       AND r.campaign_id IS NOT NULL
       AND gs.campaign_id IS NOT NULL
       AND r.patients_count > 0
      THEN round(gs.spend / r.patients_count::numeric, 2)
      ELSE NULL::numeric
    END AS cac
  FROM lead_rollup r
  LEFT JOIN google_spend gs
    ON gs.campaign_id = r.campaign_id
   AND gs.month_date = r.month_date
  ORDER BY r.month_date DESC, r.leads_count DESC, r.campaign_name;
$$;

-- ---------------------------------------------------------------------------
-- Doctor Performance signature reconciliation
-- Production exposes a 14-column contract. Historical replay may have different
-- types. Only accept exact Production or known historical signatures.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE nvx_doctor_restore (
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_doctor_acl (
  grantor_name text NOT NULL,
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $doctor_view_bridge$
DECLARE
  v_signature text;
BEGIN
  IF to_regclass('public.vw_doctor_performance_real') IS NULL THEN
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
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  -- Exact canonical Production signature measured on 2026-09-02 (14 columns).
  IF v_signature = E'1:doctor_id:uuid\n2:doctor_name:character varying(255)\n3:specialty:character varying(128)\n4:is_active:boolean\n5:clinic_id:uuid\n6:total_appointments:bigint\n7:attended_count:bigint\n8:no_show_count:bigint\n9:cancelled_count:bigint\n10:confirmed_count:bigint\n11:attended_rate_pct:numeric\n12:no_show_rate_pct:numeric\n13:estimated_revenue:numeric\n14:verified_revenue_crm:numeric' THEN
    RETURN;
  END IF;

  -- Exact historical clean-replay signature measured from Supabase Preview on 2026-09-02.
  IF v_signature IS DISTINCT FROM E'1:doctor_id:uuid\n2:doctor_name:text\n3:specialty:text\n4:is_active:boolean\n5:total_appointments:bigint\n6:attended_count:bigint\n7:no_show_count:bigint\n8:cancelled_count:bigint\n9:confirmed_count:bigint\n10:attended_rate_pct:numeric\n11:no_show_rate_pct:numeric\n12:estimated_revenue:numeric\n13:verified_revenue_crm:numeric\n14:clinic_id:uuid' THEN
    RAISE EXCEPTION 'Unexpected vw_doctor_performance_real signature:%', E'\n' || coalesce(v_signature, '<missing>');
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
    SELECT 1 FROM public.doctors d
    WHERE (d.name IS NOT NULL AND char_length(d.name) > 255)
       OR (d.specialty IS NOT NULL AND char_length(d.specialty) > 128)
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_doctor_performance_real: doctor text exceeds canonical varchar bounds';
  END IF;

  INSERT INTO nvx_doctor_restore (reloptions, owner_name)
  SELECT c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v';

  INSERT INTO nvx_doctor_acl (
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
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v'
    AND c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  IF EXISTS (
    SELECT 1
    FROM nvx_doctor_acl
    WHERE grantor_name IS DISTINCT FROM current_user
  ) THEN
    RAISE EXCEPTION
      'Cannot reproduce vw_doctor_performance_real ACL grantors as current_user=%',
      current_user;
  END IF;

  DROP VIEW public.vw_doctor_performance_real;
END;
$doctor_view_bridge$;

-- ---------------------------------------------------------------------------
-- Doctor Performance
-- Preserve the existing public view column order exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_doctor_performance_real AS
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
FROM combined c;

DO $doctor_restore$
DECLARE
  v_restore record;
  v_acl record;
BEGIN
  SELECT * INTO v_restore FROM nvx_doctor_restore LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_restore.reloptions IS NOT NULL
     AND pg_catalog.array_length(v_restore.reloptions, 1) > 0 THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_doctor_performance_real SET (%s)',
      pg_catalog.array_to_string(v_restore.reloptions, ', ')
    );
  END IF;

  FOR v_acl IN
    SELECT *
    FROM nvx_doctor_acl
    ORDER BY grantee_name, privilege_type
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT %s ON TABLE public.vw_doctor_performance_real TO %s%s',
      v_acl.privilege_type,
      CASE WHEN v_acl.grantee_name = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(v_acl.grantee_name) END,
      CASE WHEN v_acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;

  IF v_restore.owner_name <> current_user THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_doctor_performance_real OWNER TO %I',
      v_restore.owner_name
    );
  END IF;
END;
$doctor_restore$;

-- ---------------------------------------------------------------------------
-- Lead Audit signature reconciliation
-- One bridge owns detection, metadata capture, drop, rebuild, and restore.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE nvx_lead_audit_restore (
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_lead_audit_acl (
  grantor_name text NOT NULL,
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $lead_audit_bridge$
DECLARE
  v_signature text;
BEGIN
  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
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
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  -- Exact canonical Production signature measured on 2026-09-02.
  IF v_signature = E'1:lead_id:uuid\n2:lead_name:character varying(255)\n3:email_normalized:text\n4:phone_normalized:character varying(20)\n5:source:character varying(64)\n6:stage:text\n7:campaign_id:character varying(64)\n8:campaign_name:character varying(255)\n9:adset_id:character varying(64)\n10:adset_name:character varying(255)\n11:ad_id:character varying(64)\n12:ad_name:character varying(255)\n13:form_id:character varying(64)\n14:form_name:character varying(255)\n15:lead_created_at:timestamp with time zone\n16:first_outbound_at:timestamp with time zone\n17:first_inbound_at:timestamp with time zone\n18:reply_delay_minutes:integer\n19:appointment_status:appointment_status\n20:attended_at:timestamp with time zone\n21:no_show_flag:boolean\n22:estimated_revenue:numeric(12,2)\n23:crm_verified_revenue:numeric(12,2)\n24:lost_reason:text\n25:patient_id:uuid\n26:patient_ltv:numeric(12,2)\n27:settlement_id:text\n28:doctoralia_template_id:character varying(32)\n29:doctoralia_template_name:character varying(255)\n30:doctoralia_net:numeric(12,2)\n31:doctoralia_gross:numeric(12,2)\n32:settlement_date:timestamp with time zone\n33:settlement_intake_date:timestamp with time zone\n34:settlement_source:text\n35:lead_user_id:uuid\n36:patient_name:text\n37:patient_dni:text\n38:patient_phone:character varying(64)\n39:patient_last_visit:timestamp with time zone\n40:doc_patient_id:text\n41:match_confidence:numeric\n42:match_class:character varying(32)\n43:first_settlement_at:timestamp with time zone' THEN
    RETURN;
  END IF;

  -- Exact historical clean-replay signature measured from Supabase Preview on 2026-09-02.
  IF v_signature IS DISTINCT FROM E'1:lead_id:uuid\n2:lead_name:text\n3:email_normalized:text\n4:phone_normalized:text\n5:source:text\n6:stage:text\n7:campaign_id:text\n8:campaign_name:text\n9:adset_id:text\n10:adset_name:text\n11:ad_id:text\n12:ad_name:text\n13:form_id:text\n14:form_name:text\n15:lead_created_at:timestamp with time zone\n16:first_outbound_at:timestamp with time zone\n17:first_inbound_at:timestamp with time zone\n18:reply_delay_minutes:integer\n19:appointment_status:appointment_status\n20:attended_at:timestamp with time zone\n21:no_show_flag:boolean\n22:estimated_revenue:numeric(12,2)\n23:crm_verified_revenue:numeric(12,2)\n24:lost_reason:text\n25:patient_id:uuid\n26:patient_ltv:numeric\n27:settlement_id:text\n28:doctoralia_template_id:text\n29:doctoralia_template_name:text\n30:doctoralia_net:numeric\n31:doctoralia_gross:numeric\n32:settlement_date:timestamp with time zone\n33:settlement_intake_date:timestamp with time zone\n34:settlement_source:text\n35:lead_user_id:uuid\n36:patient_name:text\n37:patient_dni:text\n38:patient_phone:text\n39:patient_last_visit:timestamp with time zone\n40:doc_patient_id:text\n41:match_confidence:numeric\n42:match_class:character varying(32)\n43:first_settlement_at:timestamp with time zone' THEN
    RAISE EXCEPTION 'Unexpected vw_lead_traceability signature:%', E'\n' || coalesce(v_signature, '<missing>');
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
    RAISE EXCEPTION 'Cannot rebuild legacy vw_lead_traceability: dependent view exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'vw_lead_traceability'
      AND c.relkind = 'v'
      AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_lead_traceability: column-level ACLs detected (not supported by Production contract)';
  END IF;

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
    RAISE EXCEPTION 'Cannot reconcile vw_lead_traceability: lead text exceeds canonical varchar bounds';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.phone IS NOT NULL AND char_length(p.phone) > 64
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_lead_traceability: patient phone exceeds varchar(64)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.financial_settlements fs
    WHERE (fs.template_id IS NOT NULL AND char_length(fs.template_id) > 32)
       OR (fs.template_name IS NOT NULL AND char_length(fs.template_name) > 255)
  ) THEN
    RAISE EXCEPTION 'Cannot reconcile vw_lead_traceability: settlement text exceeds canonical varchar bounds';
  END IF;

  INSERT INTO nvx_lead_audit_restore (reloptions, owner_name)
  SELECT c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v';

  INSERT INTO nvx_lead_audit_acl (
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
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v'
    AND c.relacl IS NOT NULL
    AND acl.grantee <> c.relowner;

  IF EXISTS (
    SELECT 1
    FROM nvx_lead_audit_acl
    WHERE grantor_name IS DISTINCT FROM current_user
  ) THEN
    RAISE EXCEPTION
      'Cannot reproduce vw_lead_traceability ACL grantors as current_user=%',
      current_user;
  END IF;

  DROP VIEW public.vw_lead_traceability;
END;
$lead_audit_bridge$;

-- ---------------------------------------------------------------------------
-- Lead Audit SSOT: preserve the Production public contract but exclude inactive
-- lead rows. Explicit casts reconcile historical clean-replay source drift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_lead_traceability
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

DO $lead_audit_restore$
DECLARE
  v_restore record;
  v_acl record;
  v_safe_reloptions text[];
BEGIN
  SELECT * INTO v_restore FROM nvx_lead_audit_restore LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT pg_catalog.array_agg(opt)
    INTO v_safe_reloptions
  FROM pg_catalog.unnest(COALESCE(v_restore.reloptions, ARRAY[]::text[])) AS opt
  WHERE opt !~ '^security_invoker=';

  IF v_safe_reloptions IS NOT NULL
     AND pg_catalog.array_length(v_safe_reloptions, 1) > 0 THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_lead_traceability SET (%s)',
      pg_catalog.array_to_string(v_safe_reloptions, ', ')
    );
  END IF;

  ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);

  FOR v_acl IN
    SELECT *
    FROM nvx_lead_audit_acl
    ORDER BY grantee_name, privilege_type
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT %s ON TABLE public.vw_lead_traceability TO %s%s',
      v_acl.privilege_type,
      CASE WHEN v_acl.grantee_name = 'PUBLIC' THEN 'PUBLIC' ELSE pg_catalog.quote_ident(v_acl.grantee_name) END,
      CASE WHEN v_acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    );
  END LOOP;

  IF v_restore.owner_name <> current_user THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_lead_traceability OWNER TO %I',
      v_restore.owner_name
    );
  END IF;
END;
$lead_audit_restore$;

COMMENT ON FUNCTION public.get_campaign_report(uuid, date, date, date, date) IS
  'Canonical period-aware campaign performance from active leads + vw_control_centre_pipeline. Tenant-scoped; attendance requires Doctoralia evidence or verified client progression.';

COMMENT ON FUNCTION public.get_source_comparison(uuid, text, text) IS
  'Tenant-scoped, period-aware source performance. Filters facts before aggregation using clinic-local boundaries.';

COMMENT ON FUNCTION public.get_campaign_roi(uuid, text, text, text) IS
  'Campaign ROI with verified lead-level revenue and only provable campaign-level spend. Google campaign spend is supported; non-Google spend remains NULL.';

COMMENT ON VIEW public.vw_doctor_performance_real IS
  'Doctor performance sourced from Doctoralia appointment ingestion when doctor_id is present, with legacy lead fallback and verified settlement revenue.';

COMMENT ON VIEW public.vw_lead_traceability IS
  'Lead audit traceability restricted to active, unmerged leads while preserving the existing Production public column contract.';

COMMIT;
