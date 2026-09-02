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
-- Doctor Performance clean-replay bridge
-- Historical replay has doctor_name/specialty as text and clinic_id at
-- ordinal 14. The canonical view has varchar(255)/varchar(128) and
-- clinic_id at ordinal 5. PostgreSQL cannot change that contract with
-- CREATE OR REPLACE VIEW, so only the known incompatible legacy shape
-- is dropped and rebuilt. DROP is intentionally non-CASCADE.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE nvx_doctor_view_restore (
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_doctor_view_acl (
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $doctor_view_bridge$
DECLARE
  v_doctor_name_type text;
  v_doctor_name_len integer;
  v_specialty_type text;
  v_specialty_len integer;
  v_clinic_position integer;
BEGIN
  IF to_regclass('public.vw_doctor_performance_real') IS NULL THEN
    RETURN;
  END IF;

  SELECT c.data_type, c.character_maximum_length
    INTO v_doctor_name_type, v_doctor_name_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_doctor_performance_real'
    AND c.column_name = 'doctor_name';

  SELECT c.data_type, c.character_maximum_length
    INTO v_specialty_type, v_specialty_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_doctor_performance_real'
    AND c.column_name = 'specialty';

  SELECT c.ordinal_position
    INTO v_clinic_position
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_doctor_performance_real'
    AND c.column_name = 'clinic_id';

  -- Canonical Production signature: CREATE OR REPLACE is safe.
  IF v_doctor_name_type = 'character varying'
     AND v_doctor_name_len = 255
     AND v_specialty_type = 'character varying'
     AND v_specialty_len = 128
     AND v_clinic_position = 5 THEN
    RETURN;
  END IF;

  -- Only accept the exact historical replay signature we directly
  -- observed. Any other shape must be reviewed explicitly.
  IF NOT (
    v_doctor_name_type = 'text'
    AND v_doctor_name_len IS NULL
    AND v_specialty_type = 'text'
    AND v_specialty_len IS NULL
    AND v_clinic_position = 14
  ) THEN
    RAISE EXCEPTION
      'Unexpected vw_doctor_performance_real signature: doctor_name=%(%), specialty=%(%), clinic_position=%',
      v_doctor_name_type, v_doctor_name_len,
      v_specialty_type, v_specialty_len,
      v_clinic_position;
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
      AND child.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'Cannot rebuild legacy vw_doctor_performance_real: dependent view exists';
  END IF;

  INSERT INTO nvx_doctor_view_restore (reloptions, owner_name)
  SELECT c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_doctor_performance_real'
    AND c.relkind = 'v';

  INSERT INTO nvx_doctor_view_acl (grantee_name, privilege_type, is_grantable)
  SELECT
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

  DROP VIEW public.vw_doctor_performance_real;
END
$doctor_view_bridge$;

-- ---------------------------------------------------------------------------
-- Doctor Performance
-- Canonical public view order: clinic_id is ordinal 5.
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

DO $doctor_view_restore$
DECLARE
  v_restore record;
  v_acl record;
BEGIN
  SELECT * INTO v_restore FROM nvx_doctor_view_restore LIMIT 1;
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

  FOR v_acl IN SELECT * FROM nvx_doctor_view_acl ORDER BY grantee_name, privilege_type LOOP
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
END
$doctor_view_restore$;

-- ---------------------------------------------------------------------------
-- Lead Audit clean-replay bridge
-- Production exposes a typed 43-column contract, while historical clean replay
-- reaches this migration with a generic text/numeric placeholder. Rebuild only
-- that exact legacy shape, preserve metadata, and never use CASCADE.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE nvx_lead_audit_view_restore (
  reloptions text[],
  owner_name text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE nvx_lead_audit_view_acl (
  grantee_name text NOT NULL,
  privilege_type text NOT NULL,
  is_grantable boolean NOT NULL
) ON COMMIT DROP;

DO $lead_audit_view_bridge$
DECLARE
  v_column_count integer;
  v_lead_name_type text;
  v_lead_name_len integer;
  v_phone_type text;
  v_phone_len integer;
  v_source_type text;
  v_source_len integer;
  v_patient_ltv_type text;
  v_patient_ltv_precision integer;
  v_patient_ltv_scale integer;
  v_template_id_type text;
  v_template_id_len integer;
  v_patient_phone_type text;
  v_patient_phone_len integer;
  v_lead_security_invoker text[];
BEGIN
  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO v_column_count
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability';

  SELECT c.data_type, c.character_maximum_length
    INTO v_lead_name_type, v_lead_name_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability'
    AND c.column_name = 'lead_name';

  SELECT c.reloptions
    INTO v_lead_security_invoker
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v';

  SELECT c.data_type, c.character_maximum_length
    INTO v_phone_type, v_phone_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability'
    AND c.column_name = 'phone_normalized';

  SELECT c.data_type, c.character_maximum_length
    INTO v_source_type, v_source_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability'
    AND c.column_name = 'source';

  SELECT c.data_type, c.numeric_precision, c.numeric_scale
    INTO v_patient_ltv_type, v_patient_ltv_precision, v_patient_ltv_scale
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability'
    AND c.column_name = 'patient_ltv';

  SELECT c.data_type, c.character_maximum_length
    INTO v_template_id_type, v_template_id_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability'
    AND c.column_name = 'doctoralia_template_id';

  SELECT c.data_type, c.character_maximum_length
    INTO v_patient_phone_type, v_patient_phone_len
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'vw_lead_traceability'
    AND c.column_name = 'patient_phone';

  -- Canonical Production signature: CREATE OR REPLACE is safe.
  IF v_column_count = 43
     AND v_lead_name_type = 'character varying' AND v_lead_name_len = 255
     AND v_phone_type = 'character varying' AND v_phone_len = 20
     AND v_source_type = 'character varying' AND v_source_len = 64
     AND v_patient_ltv_type = 'numeric'
     AND v_patient_ltv_precision = 12 AND v_patient_ltv_scale = 2
     AND v_template_id_type = 'character varying' AND v_template_id_len = 32
     AND v_patient_phone_type = 'character varying' AND v_patient_phone_len = 64
     AND v_lead_security_invoker IS NOT NULL
     AND 'security_invoker=true' = ANY(v_lead_security_invoker) THEN
    RETURN;
  END IF;

  -- Exact historical clean-replay placeholder signature observed in Preview.
  IF NOT (
    v_column_count = 43
    AND v_lead_name_type = 'text' AND v_lead_name_len IS NULL
    AND v_phone_type = 'text' AND v_phone_len IS NULL
    AND v_source_type = 'text' AND v_source_len IS NULL
    AND v_patient_ltv_type = 'numeric'
    AND v_patient_ltv_precision IS NULL AND v_patient_ltv_scale IS NULL
    AND v_template_id_type = 'text' AND v_template_id_len IS NULL
    AND v_patient_phone_type = 'text' AND v_patient_phone_len IS NULL
  ) THEN
    RAISE EXCEPTION
      'Unexpected vw_lead_traceability signature: columns=%, lead_name=%(%), phone=%(%), source=%(%), patient_ltv=%(%,%), template_id=%(%), patient_phone=%(%)',
      v_column_count,
      v_lead_name_type, v_lead_name_len,
      v_phone_type, v_phone_len,
      v_source_type, v_source_len,
      v_patient_ltv_type, v_patient_ltv_precision, v_patient_ltv_scale,
      v_template_id_type, v_template_id_len,
      v_patient_phone_type, v_patient_phone_len;
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

  INSERT INTO nvx_lead_audit_view_restore (reloptions, owner_name)
  SELECT c.reloptions, pg_catalog.pg_get_userbyid(c.relowner)
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'vw_lead_traceability'
    AND c.relkind = 'v';

  INSERT INTO nvx_lead_audit_view_acl (grantee_name, privilege_type, is_grantable)
  SELECT
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

  DROP VIEW public.vw_lead_traceability;
END
$lead_audit_view_bridge$;

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

DO $lead_audit_view_restore$
DECLARE
  v_restore record;
  v_acl record;
BEGIN
  SELECT * INTO v_restore FROM nvx_lead_audit_view_restore LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_restore.reloptions IS NOT NULL
     AND pg_catalog.array_length(v_restore.reloptions, 1) > 0 THEN
    EXECUTE pg_catalog.format(
      'ALTER VIEW public.vw_lead_traceability SET (%s)',
      pg_catalog.array_to_string(v_restore.reloptions, ', ')
    );
  END IF;

  FOR v_acl IN
    SELECT * FROM nvx_lead_audit_view_acl ORDER BY grantee_name, privilege_type
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
END
$lead_audit_view_restore$;

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
