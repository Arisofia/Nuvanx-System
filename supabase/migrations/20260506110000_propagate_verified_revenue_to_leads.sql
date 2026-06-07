-- Migration: Propagate Doctoralia match revenue and patient conversion into leads
-- This migration updates matched leads with converted_patient_id and verified_revenue.

CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_matches_to_leads()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.leads l
  SET converted_patient_id = p.id,
      verified_revenue = COALESCE(rev.total_net, 0),
      stage = CASE WHEN COALESCE(rev.total_net, 0) > 0 AND l.stage IN ('lead','whatsapp','appointment')
                   THEN 'closed' ELSE l.stage END
  FROM public.doctoralia_patients dp
  LEFT JOIN public.patients p
    ON p.clinic_id = dp.clinic_id
   AND (
      p.dni = dp.doc_patient_id
      OR (
        dp.doc_patient_id LIKE 'ph:%'
        AND p.phone_normalized = dp.phone_primary
      )
   )
  LEFT JOIN LATERAL (
    SELECT SUM(fs.amount_net) AS total_net
    FROM public.financial_settlements fs
    WHERE fs.patient_id = p.id
      AND fs.cancelled_at IS NULL
  ) rev ON TRUE
  WHERE dp.lead_id = l.id
    AND dp.match_confidence >= 0.85;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_doctoralia_matches_to_leads() TO service_role;

DO $$
DECLARE
  target_job RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR target_job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'doctoralia-reconcile-leads-daily'
    LOOP
      BEGIN
        PERFORM cron.unschedule(target_job.jobid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipping stale pg_cron jobid % for doctoralia-reconcile-leads-daily: %', target_job.jobid, SQLERRM;
      END;
    END LOOP;

    PERFORM cron.schedule(
      'doctoralia-reconcile-leads-daily',
      '30 3 * * *',
      $cmd$SELECT public.reconcile_doctoralia_matches_to_leads();$cmd$
    );
  END IF;
END $$;
