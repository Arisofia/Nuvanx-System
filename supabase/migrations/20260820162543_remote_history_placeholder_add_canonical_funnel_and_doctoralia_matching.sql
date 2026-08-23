-- Restored from the authoritative production migration ledger for version 20260820162543.
-- Production already records this version as applied; fresh preview databases must
-- execute the original schema/function changes instead of a no-op history shim.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS stage_canonical text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS stage_source text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS stage_canonical_updated_at timestamptz;
ALTER TABLE public.doctoralia_appointments_ingestion ADD COLUMN IF NOT EXISTS funnel_stage text;
ALTER TABLE public.doctoralia_appointments_ingestion ADD COLUMN IF NOT EXISTS funnel_stage_reason text;
ALTER TABLE public.patient_classification ADD COLUMN IF NOT EXISTS funnel_status_canonical text;

CREATE INDEX IF NOT EXISTS idx_leads_stage_canonical ON public.leads(stage_canonical);
CREATE INDEX IF NOT EXISTS idx_doctoralia_ingestion_phone_normalized
  ON public.doctoralia_appointments_ingestion(phone_normalized);

CREATE OR REPLACE FUNCTION public.refresh_doctoralia_funnel(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  updated_count integer := 0;
BEGIN
  UPDATE public.doctoralia_appointments_ingestion a
  SET funnel_stage = CASE
        WHEN a.is_control THEN NULL
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS TRUE THEN 'valoracion_aceptada'
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS FALSE THEN 'asistio'
        ELSE NULL
      END,
      funnel_stage_reason = CASE
        WHEN a.is_control THEN 'control_excluido'
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS TRUE THEN 'valoracion_cancelada'
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS FALSE THEN 'valoracion_no_cancelada'
        ELSE NULL
      END,
      updated_at = now();

  DELETE FROM public.lead_appointment_matches lam
  USING public.leads l
  WHERE lam.lead_id = l.id
    AND l.user_id = p_user_id;

  WITH candidate_matches AS (
    SELECT
      l.id AS lead_id,
      a.id AS appointment_id,
      CASE
        WHEN a.phone_normalized = l.phone_normalized
          OR right(regexp_replace(a.phone_normalized,'[^0-9]','','g'),9) = right(regexp_replace(l.phone_normalized,'[^0-9]','','g'),9)
        THEN 'phone_normalized'
        ELSE 'phone_hash'
      END AS match_method,
      a.appointment_date,
      a.appointment_time,
      a.sheet_row,
      row_number() OVER (
        PARTITION BY l.id
        ORDER BY a.appointment_date ASC, coalesce(nullif(a.appointment_time,''),'23:59') ASC, a.sheet_row ASC
      ) AS rn
    FROM public.leads l
    JOIN public.doctoralia_appointments_ingestion a
      ON a.is_control = FALSE
     AND a.appointment_date >= (l.created_at AT TIME ZONE 'Europe/Madrid')::date
     AND a.phone_normalized IS NOT NULL
     AND a.phone_normalized <> ''
     AND l.phone_normalized IS NOT NULL
     AND l.phone_normalized <> ''
     AND (
       a.phone_normalized = l.phone_normalized
       OR right(regexp_replace(a.phone_normalized,'[^0-9]','','g'),9) = right(regexp_replace(l.phone_normalized,'[^0-9]','','g'),9)
     )
    WHERE l.deleted_at IS NULL
      AND l.user_id = p_user_id
  ), inserted AS (
    INSERT INTO public.lead_appointment_matches (lead_id, appointment_ingestion_id, match_method, is_primary)
    SELECT lead_id, appointment_id, match_method, rn = 1
    FROM candidate_matches
    ON CONFLICT (lead_id, appointment_ingestion_id) DO UPDATE
      SET match_method = EXCLUDED.match_method,
          is_primary = EXCLUDED.is_primary,
          matched_at = now()
    RETURNING lead_id
  ), rollup AS (
    SELECT
      l.id AS lead_id,
      bool_or(
        lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
        AND a.is_cancelled IS FALSE
      ) AS has_valuation,
      bool_or(
        lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
        AND a.is_cancelled IS FALSE
      ) AS has_attended
    FROM public.leads l
    LEFT JOIN public.lead_appointment_matches lam ON lam.lead_id = l.id
    LEFT JOIN public.doctoralia_appointments_ingestion a ON a.id = lam.appointment_ingestion_id
    WHERE l.user_id = p_user_id
      AND l.deleted_at IS NULL
    GROUP BY l.id
  ), updated AS (
    UPDATE public.leads l
    SET stage_source = coalesce(nullif(l.stage_source,''), l.stage),
        stage_canonical = CASE
          WHEN coalesce(r.has_attended,FALSE) THEN 'asistio'
          WHEN coalesce(r.has_valuation,FALSE) THEN 'valoracion_aceptada'
          WHEN l.first_response_at IS NOT NULL OR l.first_inbound_at IS NOT NULL THEN 'contacto'
          ELSE 'lead'
        END,
        stage_canonical_updated_at = now(),
        updated_at = now()
    FROM rollup r
    WHERE l.id = r.lead_id
    RETURNING l.id
  )
  SELECT count(*) INTO updated_count FROM updated;

  UPDATE public.patient_classification pc
  SET funnel_status_canonical = CASE
        WHEN pc.lead_id IS NOT NULL THEN l.stage_canonical
        WHEN lower(coalesce(pc.funnel_status,'')) = 'lead' THEN 'lead'
        WHEN lower(coalesce(pc.funnel_status,'')) IN ('scheduled','appointment') THEN 'valoracion_aceptada'
        ELSE NULL
      END,
      updated_at = now()
  FROM public.leads l
  WHERE pc.lead_id = l.id;

  RETURN coalesce(updated_count,0);
END;
$function$;
