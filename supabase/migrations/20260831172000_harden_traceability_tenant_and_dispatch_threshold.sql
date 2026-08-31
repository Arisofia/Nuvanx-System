-- Forward hardening after restoring the authoritative 2026-08-31 Production ledger.
-- Do not rewrite the already-applied historical migrations this supersedes.

-- 1. Keep Doctoralia traceability tenant-safe.
-- doctoralia_appointments_ingestion stores the canonical clinic name rather than clinic_id,
-- so resolve that name through public.clinics and require the lead to belong to the same clinic.
CREATE OR REPLACE VIEW public.master_pacientes_trazabilidad
WITH (security_invoker = true)
AS
WITH leads_clean AS (
  SELECT DISTINCT ON (leads.phone_normalized, leads.clinic_id)
    leads.id,
    leads.name,
    leads.email_normalized,
    leads.phone_normalized,
    leads.source,
    leads.campaign_name,
    leads.ad_name,
    leads.form_name,
    leads.created_at,
    leads.clinic_id
  FROM public.leads
  WHERE leads.phone_normalized IS NOT NULL
    AND leads.phone_normalized::text <> ''::text
    AND leads.deleted_at IS NULL
  ORDER BY leads.phone_normalized, leads.clinic_id, leads.created_at DESC
)
SELECT
  l.id                                          AS lead_id,
  l.name                                        AS lead_name_meta,
  l.source                                      AS lead_source,
  l.campaign_name                               AS meta_campaign,
  l.form_name                                   AS meta_form,
  l.created_at                                  AS meta_lead_date,
  dai.doctoralia_id                             AS doc_patient_id,
  dai.patient_name                              AS patient_name_clinical,
  dai.phone_normalized,
  dai.appointment_date,
  dai.appointment_time,
  dai.estado                                    AS appointment_status,
  dai.treatment                                 AS treatment_name,
  dai.amount::numeric(12, 2)                    AS actual_revenue,
  dai.agenda                                    AS doctor_agenda,
  dai.origin                                    AS clinical_source,
  dai.appointment_date - l.created_at::date     AS days_to_conversion
FROM leads_clean l
JOIN public.doctoralia_appointments_ingestion dai
  ON l.phone_normalized::text = dai.phone_normalized::text
JOIN public.clinics c
  ON c.name = dai.clinic
 AND c.id = l.clinic_id
ORDER BY dai.appointment_date DESC NULLS LAST, l.created_at DESC;

COMMENT ON VIEW public.master_pacientes_trazabilidad IS
'Tenant-safe Meta/Doctoralia traceability: phone lineage plus canonical clinic-name to clinic-id resolution.';

-- 2. Reject invalid stale-dispatch thresholds instead of allowing an immediate/future timeout sweep.
CREATE OR REPLACE FUNCTION public.nvx_cleanup_stale_dispatch_ledger(
  p_stale_threshold_minutes integer DEFAULT 120
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_updated integer;
BEGIN
  IF p_stale_threshold_minutes IS NULL
     OR p_stale_threshold_minutes < 1
     OR p_stale_threshold_minutes > 10080 THEN
    RAISE EXCEPTION 'p_stale_threshold_minutes must be between 1 and 10080'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.revops_dispatch_ledger
  SET status        = 'timeout',
      error_message = pg_catalog.format(
        'Stale dispatch: auto-timeout after %s minutes in dispatched state',
        p_stale_threshold_minutes
      ),
      resolved_at   = pg_catalog.now()
  WHERE status = 'dispatched'
    AND dispatched_at < pg_catalog.now()
      - pg_catalog.make_interval(mins => p_stale_threshold_minutes);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$fn$;

REVOKE ALL ON FUNCTION public.nvx_cleanup_stale_dispatch_ledger(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_cleanup_stale_dispatch_ledger(integer)
  TO service_role;

COMMENT ON FUNCTION public.nvx_cleanup_stale_dispatch_ledger(integer) IS
'Fail-closed stale-dispatch cleanup. Threshold must be 1..10080 minutes; service_role only.';
