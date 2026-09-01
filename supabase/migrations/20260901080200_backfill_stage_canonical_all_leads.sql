-- Backfill stage_canonical for 792 leads

-- Disable trigger temporarily if needed (assuming it exists and might interfere)
-- ALTER TABLE public.leads DISABLE TRIGGER trg_nvx_sync_first_response_at;

-- Update stage_canonical using priority logic
UPDATE public.leads l
SET stage_canonical = 
    CASE 
        WHEN l.lost_reason IS NOT NULL THEN 'perdido'
        WHEN (SELECT COALESCE(SUM(amount_net), 0) FROM public.financial_settlements WHERE lead_id = l.id AND cancelled_at IS NULL) > 0 THEN 'cliente'
        WHEN EXISTS (SELECT 1 FROM public.lead_appointment_matches m JOIN public.doctoralia_appointments_ingestion a ON m.appointment_ingestion_id = a.id WHERE m.lead_id = l.id AND a.status = 'attended') THEN 'asistio'
        WHEN EXISTS (SELECT 1 FROM public.lead_appointment_matches m JOIN public.doctoralia_appointments_ingestion a ON m.appointment_ingestion_id = a.id WHERE m.lead_id = l.id AND a.status = 'scheduled') THEN 'valoracion_aceptada'
        WHEN l.first_inbound_at IS NOT NULL THEN 'contacto'
        WHEN l.first_outbound_at IS NOT NULL THEN 'contactado'
        WHEN l.source = 'doctoralia_marketing' THEN 'lead'
        ELSE 'lead'
    END
WHERE l.stage_canonical IS NULL AND l.deleted_at IS NULL AND l.merged_into_lead_id IS NULL;

-- Update patient classification funnel status
UPDATE public.patient_classification pc
SET funnel_status_canonical = l.stage_canonical
FROM public.leads l
WHERE pc.lead_id = l.id AND pc.funnel_status_canonical IS DISTINCT FROM l.stage_canonical;

-- Re-enable trigger
-- ALTER TABLE public.leads ENABLE TRIGGER trg_nvx_sync_first_response_at;

DO $$
BEGIN
  RAISE NOTICE 'Backfill complete. Please run SELECT count(*), stage_canonical, source FROM leads WHERE deleted_at IS NULL GROUP BY stage_canonical, source; to view the breakdown.';
END $$;
