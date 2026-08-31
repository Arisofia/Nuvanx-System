-- Forward repair for out-of-band 2026-08-31 backfill/view migrations.
-- Historical migration files remain byte-equivalent to Production audit history.

-- 1. Re-run the existing canonical Doctoralia funnel owner for every active lead owner.
-- The function itself defines control/cancellation exclusions and lead-stage reconciliation.
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
  AND pg_catalog.lower(pg_catalog.coalesce(pc.funnel_status, '')) IN ('converted', 'returning')
  AND pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical;

-- 2. Keep source_to_cash dependency-safe and deterministic.
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
