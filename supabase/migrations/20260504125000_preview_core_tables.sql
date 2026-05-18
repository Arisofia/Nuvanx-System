-- Compatibility scaffolding for Supabase Preview / core-only databases.
--
-- Some preview branches start from a reduced schema where public.leads does not
-- exist yet. In that case 20260504130000 correctly skips the real
-- vw_lead_traceability refresh, but later historical migrations still compile
-- functions that reference public.vw_lead_traceability. Keep a zero-row
-- compatibility view so those function definitions can compile. Later
-- migrations replace or drop/recreate the real view when the source tables are
-- available.

DO $$
BEGIN
  IF to_regclass('public.vw_lead_traceability') IS NULL THEN
    EXECUTE $view$
    CREATE OR REPLACE VIEW public.vw_lead_traceability AS
    SELECT
      NULL::UUID        AS lead_id,
      NULL::TEXT        AS lead_name,
      NULL::TEXT        AS email_normalized,
      NULL::TEXT        AS phone_normalized,
      NULL::TEXT        AS source,
      NULL::TEXT        AS stage,
      NULL::TEXT        AS campaign_id,
      NULL::TEXT        AS campaign_name,
      NULL::TEXT        AS adset_id,
      NULL::TEXT        AS adset_name,
      NULL::TEXT        AS ad_id,
      NULL::TEXT        AS ad_name,
      NULL::TEXT        AS form_id,
      NULL::TEXT        AS form_name,
      NULL::TIMESTAMPTZ AS lead_created_at,
      NULL::TIMESTAMPTZ AS first_outbound_at,
      NULL::TIMESTAMPTZ AS first_inbound_at,
      NULL::NUMERIC     AS reply_delay_minutes,
      NULL::TEXT        AS appointment_status,
      NULL::TIMESTAMPTZ AS attended_at,
      NULL::BOOLEAN     AS no_show_flag,
      NULL::NUMERIC     AS estimated_revenue,
      NULL::NUMERIC     AS crm_verified_revenue,
      NULL::TEXT        AS lost_reason,
      NULL::UUID        AS patient_id,
      NULL::NUMERIC     AS patient_ltv,
      NULL::TEXT        AS settlement_id,
      NULL::TEXT        AS doctoralia_template_id,
      NULL::TEXT        AS doctoralia_template_name,
      NULL::NUMERIC     AS doctoralia_net,
      NULL::NUMERIC     AS doctoralia_gross,
      NULL::TIMESTAMPTZ AS settlement_date,
      NULL::TIMESTAMPTZ AS settlement_intake_date,
      NULL::TEXT        AS settlement_source,
      NULL::UUID        AS lead_user_id,
      NULL::TEXT        AS patient_name,
      NULL::TEXT        AS patient_dni,
      NULL::VARCHAR(64) AS patient_phone,
      NULL::TIMESTAMPTZ AS patient_last_visit,
      NULL::TEXT        AS doc_patient_id,
      NULL::NUMERIC     AS match_confidence,
      NULL::VARCHAR(32) AS match_class,
      NULL::TIMESTAMPTZ AS first_settlement_at
    WHERE FALSE;
    $view$;

    EXECUTE 'ALTER VIEW public.vw_lead_traceability SET (security_invoker = true)';
    EXECUTE 'GRANT SELECT ON public.vw_lead_traceability TO authenticated';
    EXECUTE 'GRANT SELECT ON public.vw_lead_traceability TO service_role';
    RAISE NOTICE 'Created zero-row vw_lead_traceability compatibility view for preview schema';
  ELSE
    RAISE NOTICE 'vw_lead_traceability already exists; compatibility scaffold skipped';
  END IF;
END $$;
