-- Follow-up alignment for Revenue Operating Contract v1.

ALTER TABLE public.google_click_attributions
  ADD COLUMN IF NOT EXISTS last_reconciliation_attempt_at TIMESTAMPTZ;

-- Preserve the live lead stage vocabulary (lead / appointment / convertido).
CREATE OR REPLACE FUNCTION public.refresh_doctoralia_appointment_engine(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  DELETE FROM public.lead_appointment_matches lam
  USING public.leads l
  WHERE lam.lead_id = l.id
    AND l.user_id = p_user_id;

  WITH scoped_user AS (
    SELECT u.id AS user_id, u.clinic_id
    FROM public.users u
    WHERE u.id = p_user_id
  ),
  candidate_matches AS (
    SELECT
      l.id AS lead_id,
      a.id AS appointment_id,
      CASE
        WHEN l.phone_normalized IS NOT NULL
          AND l.phone_normalized <> ''
          AND (
            a.phone_normalized = l.phone_normalized
            OR RIGHT(regexp_replace(a.phone_normalized, '[^0-9]', '', 'g'), 9)
             = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
          ) THEN 'phone_normalized'
        ELSE 'phone_hash'
      END AS match_method,
      a.appointment_date,
      a.appointment_time,
      a.estado,
      a.source_key,
      ROW_NUMBER() OVER (
        PARTITION BY l.id
        ORDER BY a.appointment_date ASC,
                 COALESCE(NULLIF(a.appointment_time, ''), '23:59') ASC,
                 a.sheet_row ASC
      ) AS rn
    FROM public.leads l
    JOIN scoped_user su
      ON (
        (su.clinic_id IS NOT NULL AND l.clinic_id = su.clinic_id)
        OR (su.clinic_id IS NULL AND l.user_id = su.user_id)
      )
    JOIN public.doctoralia_appointments_ingestion a
      ON a.is_control = FALSE
     AND a.is_cancelled = FALSE
     AND a.appointment_date >= (l.created_at AT TIME ZONE 'Europe/Madrid')::date
     AND (
       (
         l.phone_normalized IS NOT NULL
         AND l.phone_normalized <> ''
         AND a.phone_normalized IS NOT NULL
         AND (
           a.phone_normalized = l.phone_normalized
           OR RIGHT(regexp_replace(a.phone_normalized, '[^0-9]', '', 'g'), 9)
            = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
         )
       )
       OR (
         l.telefono_hash IS NOT NULL
         AND l.telefono_hash <> ''
         AND a.phone_normalized IS NOT NULL
         AND encode(extensions.digest(public.normalize_phone(a.phone_normalized), 'sha256'), 'hex') = l.telefono_hash
       )
     )
    WHERE l.deleted_at IS NULL
      AND l.user_id = p_user_id
  ),
  inserted AS (
    INSERT INTO public.lead_appointment_matches (
      lead_id,
      appointment_ingestion_id,
      match_method,
      is_primary
    )
    SELECT lead_id, appointment_id, match_method, rn = 1
    FROM candidate_matches
    ON CONFLICT (lead_id, appointment_ingestion_id)
    DO UPDATE SET
      match_method = EXCLUDED.match_method,
      is_primary = EXCLUDED.is_primary,
      matched_at = now()
    RETURNING lead_id
  ),
  primary_match AS (
    SELECT
      cm.lead_id,
      cm.appointment_date,
      cm.appointment_time,
      cm.estado,
      cm.source_key
    FROM candidate_matches cm
    WHERE cm.rn = 1
  ),
  updated AS (
    UPDATE public.leads l
    SET
      appointment_date = CASE
        WHEN pm.appointment_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'
          THEN (pm.appointment_date + substring(pm.appointment_time from 1 for 5)::time) AT TIME ZONE 'Europe/Madrid'
        ELSE pm.appointment_date::timestamp AT TIME ZONE 'Europe/Madrid'
      END,
      appointment_status = CASE
        WHEN lower(pm.estado) IN ('realizada','pagada') THEN 'attended'
        WHEN lower(pm.estado) = 'no acude' THEN 'no_show'
        ELSE 'scheduled'
      END,
      attended_at = CASE
        WHEN lower(pm.estado) IN ('realizada','pagada') THEN
          CASE
            WHEN pm.appointment_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]'
              THEN (pm.appointment_date + substring(pm.appointment_time from 1 for 5)::time) AT TIME ZONE 'Europe/Madrid'
            ELSE pm.appointment_date::timestamp AT TIME ZONE 'Europe/Madrid'
          END
        ELSE l.attended_at
      END,
      no_show_flag = lower(pm.estado) = 'no acude',
      appointment_source = 'doctoralia',
      appointment_external_id = pm.source_key,
      appointment_matched_at = now(),
      stage = CASE
        WHEN l.stage = 'convertido' THEN l.stage
        WHEN l.stage = 'lead' THEN 'appointment'
        ELSE l.stage
      END,
      updated_at = now()
    FROM primary_match pm
    WHERE l.id = pm.lead_id
    RETURNING l.id
  )
  SELECT COUNT(*) INTO updated_count FROM updated;

  RETURN COALESCE(updated_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_doctoralia_appointment_engine(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_doctoralia_appointment_engine(UUID) TO service_role;
