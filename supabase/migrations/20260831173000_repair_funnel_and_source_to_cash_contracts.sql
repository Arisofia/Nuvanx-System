-- Forward repair for out-of-band 2026-08-31 backfill/view migrations.
-- Historical migration files remain byte-equivalent to Production audit history.
-- This migration is still unapplied in Production. Keep the canonical funnel mapping,
-- but avoid repeating an expensive full-table Doctoralia UPDATE once per lead owner.

-- 1. Normalize Doctoralia-derived funnel metadata exactly once.
-- These two triggers do not derive funnel_stage/funnel_stage_reason. The duplicate guard
-- is O(N^2) for bulk updates and the LIVE mirror performs a per-row projection UPSERT,
-- so firing either for metadata-only normalization is unnecessary and caused Production
-- to exceed statement_timeout. Trigger state is transactional if the migration aborts.
ALTER TABLE public.doctoralia_appointments_ingestion
  DISABLE TRIGGER trg_guard_exact_doctoralia_appointment_duplicate;

ALTER TABLE public.doctoralia_appointments_ingestion
  DISABLE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row;

WITH expected AS (
  SELECT
    a.id,
    CASE
      WHEN a.is_control THEN NULL::text
      WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
           AND a.is_cancelled IS TRUE THEN NULL::text
      WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
           AND a.is_cancelled IS FALSE
           AND lower(trim(a.estado)) <> 'no acude' THEN 'asistio'::text
      ELSE NULL::text
    END AS funnel_stage,
    CASE
      WHEN a.is_control THEN 'control_excluido'::text
      WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
           AND a.is_cancelled IS TRUE THEN 'valoracion_cancelada'::text
      WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
           AND a.is_cancelled IS FALSE
           AND lower(trim(a.estado)) = 'no acude' THEN 'valoracion_no_asistio'::text
      WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
           AND a.is_cancelled IS FALSE THEN 'valoracion_no_cancelada'::text
      ELSE NULL::text
    END AS funnel_stage_reason
  FROM public.doctoralia_appointments_ingestion a
)
UPDATE public.doctoralia_appointments_ingestion a
SET funnel_stage = e.funnel_stage,
    funnel_stage_reason = e.funnel_stage_reason,
    updated_at = pg_catalog.now()
FROM expected e
WHERE a.id = e.id
  AND (
    a.funnel_stage IS DISTINCT FROM e.funnel_stage
    OR a.funnel_stage_reason IS DISTINCT FROM e.funnel_stage_reason
  );

ALTER TABLE public.doctoralia_appointments_ingestion
  ENABLE TRIGGER trg_guard_exact_doctoralia_appointment_duplicate;

ALTER TABLE public.doctoralia_appointments_ingestion
  ENABLE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row;

-- 2. Harden the canonical owner so future refreshes preserve the same funnel mapping
-- without blindly rewriting every ingestion row. Only genuinely stale derived metadata
-- is updated; user-specific matching and lead rollup behavior remain unchanged.
CREATE OR REPLACE FUNCTION public.refresh_doctoralia_funnel(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH expected AS (
    SELECT
      a.id,
      CASE
        WHEN a.is_control THEN NULL::text
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS TRUE THEN NULL::text
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS FALSE
             AND lower(trim(a.estado)) <> 'no acude' THEN 'asistio'::text
        ELSE NULL::text
      END AS funnel_stage,
      CASE
        WHEN a.is_control THEN 'control_excluido'::text
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS TRUE THEN 'valoracion_cancelada'::text
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS FALSE
             AND lower(trim(a.estado)) = 'no acude' THEN 'valoracion_no_asistio'::text
        WHEN lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
             AND a.is_cancelled IS FALSE THEN 'valoracion_no_cancelada'::text
        ELSE NULL::text
      END AS funnel_stage_reason
    FROM public.doctoralia_appointments_ingestion a
  )
  UPDATE public.doctoralia_appointments_ingestion a
  SET funnel_stage = e.funnel_stage,
      funnel_stage_reason = e.funnel_stage_reason,
      updated_at = pg_catalog.now()
  FROM expected e
  WHERE a.id = e.id
    AND (
      a.funnel_stage IS DISTINCT FROM e.funnel_stage
      OR a.funnel_stage_reason IS DISTINCT FROM e.funnel_stage_reason
    );

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
          matched_at = pg_catalog.now()
    RETURNING lead_id
  ), rollup AS (
    SELECT
      l.id AS lead_id,
      bool_or(
        lower(coalesce(a.subject,'') || ' ' || coalesce(a.treatment,'') || ' ' || coalesce(a.appointment_type,'')) ~ '(valoraci|primera visita|primera)'
        AND a.is_cancelled IS FALSE
        AND lower(trim(a.estado)) <> 'no acude'
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
        stage_canonical_updated_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
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
      updated_at = pg_catalog.now()
  FROM public.leads l
  WHERE pc.lead_id = l.id;

  RETURN coalesce(updated_count,0);
END;
$function$;

-- 3. Re-run the canonical owner for each active lead owner after the one-time metadata
-- normalization. The function now sees zero global DAI drift in the common case and only
-- performs the user-scoped match/rollup work.
DO $refresh_funnel$
DECLARE
  v_user_id uuid;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT l.user_id
    FROM public.leads l
    WHERE l.deleted_at IS NULL
      AND l.user_id IS NOT NULL
    ORDER BY l.user_id
  LOOP
    PERFORM public.refresh_doctoralia_funnel(v_user_id);
  END LOOP;
END;
$refresh_funnel$;

-- Rows linked only to retired/deleted leads are not visited by the active-user refresh.
-- Do not invent a conversion stage: align them to the linked lead's canonical stage,
-- which is NULL when no currently supported canonical acquisition/valuation stage exists.
UPDATE public.patient_classification pc
SET funnel_status_canonical = l.stage_canonical,
    updated_at = pg_catalog.now()
FROM public.leads l
WHERE pc.lead_id = l.id
  AND pg_catalog.lower(coalesce(pc.funnel_status, '')) IN ('converted', 'returning')
  AND pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical;

-- 4. Keep source_to_cash dependency-safe and deterministic.
-- CREATE OR REPLACE preserves dependents; DAI selection uses a stable revenue-aware order,
-- and DAI-only matches expose Doctoralia ID before falling back to normalized phone.
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
  l.id                                                          AS lead_id,
  l.user_id,
  l.name                                                        AS lead_name,
  l.source                                                      AS acquisition_channel,
  COALESCE(l.stage_canonical, l.stage)                          AS current_stage,
  l.campaign_name,
  l.campaign_id,
  l.created_at                                                  AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.attended_at,
  l.no_show_flag,
  l.revenue                                                     AS crm_revenue,
  l.verified_revenue,
  COALESCE(
    p.id::text,
    NULLIF(pg_catalog.btrim(dai.doctoralia_id), ''),
    dai.phone_normalized
  )                                                             AS patient_id,
  COALESCE(p.name, dai.dai_patient_name)                        AS patient_name,
  p.total_ltv                                                   AS doctoralia_ltv,
  fs.amount_net                                                 AS settled_amount,
  fs.template_name                                              AS financing_template,
  fs.settled_at,
  (p.id IS NOT NULL OR dai.phone_normalized IS NOT NULL)        AS matched_to_doctoralia,
  COALESCE(fs.amount_net, l.verified_revenue, l.revenue, 0::numeric) AS effective_revenue
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

COMMENT ON VIEW public.source_to_cash IS
'Canonical lead-to-cash view: active leads only, deterministic DAI matching, stable Doctoralia identity, dependency-safe replacement.';
