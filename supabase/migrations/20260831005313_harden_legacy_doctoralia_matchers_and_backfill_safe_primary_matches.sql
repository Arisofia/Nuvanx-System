-- Replace legacy Doctoralia matchers that mutated stage/revenue with evidence-only matching.

CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_clinic_id uuid;
  v_inserted integer := 0;
BEGIN
  SELECT u.clinic_id INTO v_clinic_id
  FROM public.users u
  WHERE u.id = p_user_id;

  IF v_clinic_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH active_leads AS (
    SELECT
      l.id,
      l.created_at,
      l.phone_normalized,
      count(*) OVER (PARTITION BY l.phone_normalized) AS active_lead_phone_count
    FROM public.leads l
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND l.clinic_id = v_clinic_id
      AND l.phone_normalized IS NOT NULL
      AND l.phone_normalized <> ''
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
  ), doctoralia_identity AS (
    SELECT
      a.phone_normalized,
      count(DISTINCT NULLIF(btrim(a.doctoralia_id), '')) AS doctoralia_identity_count
    FROM public.doctoralia_appointments_ingestion a
    WHERE a.phone_normalized IS NOT NULL
      AND a.phone_normalized <> ''
    GROUP BY a.phone_normalized
  ), candidates AS (
    SELECT DISTINCT ON (l.id)
      l.id AS lead_id,
      a.id AS appointment_ingestion_id,
      a.appointment_date,
      appointment_clock.start_time,
      CASE
        WHEN appointment_clock.start_time IS NULL THEN NULL::timestamptz
        ELSE (
          (a.appointment_date::text || ' ' ||
            CASE WHEN length(appointment_clock.start_time) = 4 THEN '0' || appointment_clock.start_time ELSE appointment_clock.start_time END
          )::timestamp without time zone AT TIME ZONE 'Europe/Madrid'
        )
      END AS appointment_at
    FROM active_leads l
    JOIN doctoralia_identity di
      ON di.phone_normalized = l.phone_normalized
     AND di.doctoralia_identity_count = 1
    JOIN public.doctoralia_appointments_ingestion a
      ON a.phone_normalized = l.phone_normalized
    CROSS JOIN LATERAL (
      SELECT substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]') AS start_time
    ) appointment_clock
    WHERE l.active_lead_phone_count = 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_appointment_matches existing
        WHERE existing.lead_id = l.id AND existing.is_primary
      )
      AND a.appointment_date IS NOT NULL
      AND COALESCE(a.is_cancelled, false) = false
      AND lower(btrim(COALESCE(NULLIF(btrim(a.status), ''), NULLIF(btrim(a.estado), ''), ''))) <> ALL (
        ARRAY['anulada','anulado','cancelada','cancelado','cancelled','canceled','no acude','no acudió','no acudio','no_show','no show','noshow']
      )
      AND (
        a.appointment_date > l.created_at::date
        OR (
          a.appointment_date = l.created_at::date
          AND appointment_clock.start_time IS NOT NULL
          AND (
            (a.appointment_date::text || ' ' ||
              CASE WHEN length(appointment_clock.start_time) = 4 THEN '0' || appointment_clock.start_time ELSE appointment_clock.start_time END
            )::timestamp without time zone AT TIME ZONE 'Europe/Madrid'
          ) >= l.created_at
        )
      )
    ORDER BY l.id, a.appointment_date, appointment_at NULLS LAST, a.id
  ), inserted AS (
    INSERT INTO public.lead_appointment_matches (
      lead_id,
      appointment_ingestion_id,
      match_method,
      is_primary,
      matched_at
    )
    SELECT
      c.lead_id,
      c.appointment_ingestion_id,
      'phone_normalized',
      true,
      now()
    FROM candidates c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$function$;

COMMENT ON FUNCTION public.match_leads_to_doctoralia_by_phone(uuid) IS
'Canonical evidence matcher. Creates at most one primary lead_appointment_matches row only for a unique active lead phone, unique Doctoralia identity, non-cancelled post-capture appointment. Never mutates leads.stage, verified_revenue or appointment_date.';

CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_phone()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- Deprecated global matcher. Historical implementation linked patients/revenue
  -- from financial_settlements by phone. Scope-aware matching now requires p_user_id.
  RETURN 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_doctoralia_leads_by_phone()
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- Deprecated alias for the unsafe global matcher.
  RETURN 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_matches_to_leads()
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- Deprecated compatibility no-op. Historical implementation classified
  -- financial settlement template text into appointment/treatment/closed stages.
  -- Canonical progression is ordered Doctoralia appointment evidence only.
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.match_leads_to_doctoralia_by_name(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- Name-only matching is insufficient evidence for canonical patient identity.
  RETURN 0;
END;
$function$;

COMMENT ON FUNCTION public.match_leads_to_doctoralia_by_name(uuid) IS
'DEPRECATED no-op. Name-only matching cannot create canonical patient/conversion evidence.';

-- Preserve exact-DNI matching only as legacy identity enrichment; it never changes
-- canonical pipeline stages because vw_control_centre_pipeline ignores converted_patient_id.
COMMENT ON FUNCTION public.match_leads_to_doctoralia_by_dni(uuid) IS
'Legacy exact-DNI identity enrichment only. Does not constitute canonical Doctoralia journey or conversion evidence.';
