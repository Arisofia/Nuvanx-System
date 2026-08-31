-- Centralize the canonical Doctoralia match validity contract and prune stale rows.

CREATE OR REPLACE FUNCTION public.nvx_doctoralia_match_is_valid(
  p_lead_id uuid,
  p_appointment_ingestion_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH candidate AS (
    SELECT
      l.id AS lead_id,
      l.created_at AS lead_created_at,
      l.phone_normalized AS lead_phone,
      l.deleted_at,
      l.merged_into_lead_id,
      l.source,
      a.id AS appointment_id,
      a.phone_normalized AS appointment_phone,
      a.doctoralia_id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.estado,
      a.is_cancelled,
      substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]') AS start_time
    FROM public.leads l
    JOIN public.doctoralia_appointments_ingestion a
      ON a.id = p_appointment_ingestion_id
    WHERE l.id = p_lead_id
  )
  SELECT COALESCE((
    SELECT
      c.deleted_at IS NULL
      AND c.merged_into_lead_id IS NULL
      AND lower(btrim(COALESCE(c.source, '')::text)) <> 'doctoralia'
      AND c.lead_phone IS NOT NULL
      AND c.lead_phone <> ''
      AND c.appointment_phone = c.lead_phone
      AND c.appointment_date IS NOT NULL
      AND COALESCE(c.is_cancelled, false) = false
      AND lower(btrim(COALESCE(NULLIF(btrim(c.status), ''), NULLIF(btrim(c.estado), ''), ''))) <> ALL (
        ARRAY['anulada','anulado','cancelada','cancelado','cancelled','canceled','no acude','no acudió','no acudio','no_show','no show','noshow']
      )
      AND (
        SELECT count(*)
        FROM public.leads l2
        WHERE l2.deleted_at IS NULL
          AND l2.merged_into_lead_id IS NULL
          AND l2.phone_normalized = c.lead_phone
      ) = 1
      AND (
        SELECT count(DISTINCT NULLIF(btrim(a2.doctoralia_id), ''))
        FROM public.doctoralia_appointments_ingestion a2
        WHERE a2.phone_normalized = c.appointment_phone
      ) = 1
      AND (
        c.appointment_date > (c.lead_created_at AT TIME ZONE 'Europe/Madrid')::date
        OR (
          c.appointment_date = (c.lead_created_at AT TIME ZONE 'Europe/Madrid')::date
          AND c.start_time IS NOT NULL
          AND (
            (c.appointment_date::text || ' ' ||
              CASE WHEN length(c.start_time) = 4 THEN '0' || c.start_time ELSE c.start_time END
            )::timestamp without time zone AT TIME ZONE 'Europe/Madrid'
          ) >= c.lead_created_at
        )
      )
    FROM candidate c
  ), false);
$function$;

COMMENT ON FUNCTION public.nvx_doctoralia_match_is_valid(uuid,uuid) IS
'Canonical Doctoralia identity-evidence predicate: active unique lead phone, one Doctoralia identity for that phone, valid non-cancelled post-capture appointment, Madrid same-day timestamp boundary.';

DELETE FROM public.lead_appointment_matches lam
WHERE NOT public.nvx_doctoralia_match_is_valid(lam.lead_id, lam.appointment_ingestion_id);

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

  DELETE FROM public.lead_appointment_matches lam
  USING public.leads l
  WHERE l.id = lam.lead_id
    AND l.clinic_id = v_clinic_id
    AND NOT public.nvx_doctoralia_match_is_valid(lam.lead_id, lam.appointment_ingestion_id);

  WITH candidates AS (
    SELECT DISTINCT ON (l.id)
      l.id AS lead_id,
      a.id AS appointment_ingestion_id,
      a.appointment_date,
      substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]') AS start_time
    FROM public.leads l
    JOIN public.doctoralia_appointments_ingestion a
      ON a.phone_normalized = l.phone_normalized
    WHERE l.deleted_at IS NULL
      AND l.merged_into_lead_id IS NULL
      AND l.clinic_id = v_clinic_id
      AND lower(btrim(COALESCE(l.source, '')::text)) <> 'doctoralia'
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_appointment_matches existing
        WHERE existing.lead_id = l.id AND existing.is_primary
      )
      AND public.nvx_doctoralia_match_is_valid(l.id, a.id)
    ORDER BY
      l.id,
      a.appointment_date,
      CASE
        WHEN substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]') IS NULL THEN time '23:59:59'
        ELSE (
          CASE
            WHEN length(substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]')) = 4
              THEN '0' || substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]')
            ELSE substring(COALESCE(a.appointment_time, '') FROM '(?:[01]?[0-9]|2[0-3]):[0-5][0-9]')
          END
        )::time
      END,
      a.id
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
'Canonical self-healing matcher. Uses nvx_doctoralia_match_is_valid as the single evidence predicate and creates one primary identity anchor per lead without mutating lead stage/revenue fields.';
