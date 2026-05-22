-- 20260504203000_doctoralia_lead_traceability_unified_view.sql
-- Seed definition so dependent migrations (e.g. doctoralia_patient_ltv) can
-- reference this view before the canonical enriched redefinition.
-- Canonical definition lives in:
--   20260514084000_unify_appointment_source_of_truth.sql

CREATE OR REPLACE VIEW public.vw_doctoralia_lead_traceability_unified AS
SELECT
  dr.*,
  COALESCE(
    normalize_phone(dr.paciente_telefono),
    normalize_phone(dr.phone_primary),
    normalize_phone(dr.phone_secondary)
  ) AS paciente_telefono_normalized,
  l.id                  AS lead_id,
  l.external_id         AS leadgen_id,
  l.name                AS lead_full_name,
  l.phone               AS lead_phone,
  l.phone_normalized    AS lead_phone_normalized,
  l.source              AS lead_source,
  l.stage               AS lead_stage,
  l.created_at          AS lead_created_at,
  l.campaign_name       AS campaign_name,
  l.ad_name             AS ad_name,
  l.form_name           AS form_name,
  NULL::text            AS campaign_id,
  NULL::text            AS adset_id,
  NULL::text            AS adset_name,
  NULL::text            AS ad_id,
  l.revenue             AS lead_revenue_estimated,
  l.verified_revenue    AS lead_revenue_verified,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.converted_patient_id AS lead_converted_patient_id,
  l.priority            AS lead_priority
FROM public.vw_doctoralia_trazabilidad_360 dr
LEFT JOIN public.leads l
  ON (
    normalize_phone(dr.paciente_telefono) = l.phone_normalized
    OR normalize_phone(dr.phone_primary)  = l.phone_normalized
    OR normalize_phone(dr.phone_secondary) = l.phone_normalized
  );

ALTER VIEW public.vw_doctoralia_lead_traceability_unified
  SET (security_invoker = true);
