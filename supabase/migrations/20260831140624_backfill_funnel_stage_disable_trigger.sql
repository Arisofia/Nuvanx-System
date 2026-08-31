
-- El trigger O(N²) de dedup falla en UPDATE masivo incluso de sólo funnel_stage.
-- Deshabilitar temporalmente, aplicar backfill, rehabilitar.
-- El trigger no tiene ninguna función de negocio para funnel_stage (es metadato derivado).

ALTER TABLE public.doctoralia_appointments_ingestion
  DISABLE TRIGGER trg_guard_exact_doctoralia_appointment_duplicate;

ALTER TABLE public.doctoralia_appointments_ingestion
  DISABLE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row;

UPDATE public.doctoralia_appointments_ingestion
SET funnel_stage = CASE
      WHEN LOWER(estado) IN ('realizada', 'pagada')      THEN 'asistio'
      WHEN LOWER(estado) IN ('no acude', 'no_acude')     THEN 'no_show'
      WHEN LOWER(estado) IN ('anulada', 'cancelada')     THEN 'cancelado'
      WHEN LOWER(estado) IN ('pendiente', 'confirmada')  THEN 'agendado'
      ELSE 'agendado'
    END,
    funnel_stage_reason = 'backfill_20260831',
    updated_at = NOW()
WHERE funnel_stage IS NULL;

ALTER TABLE public.doctoralia_appointments_ingestion
  ENABLE TRIGGER trg_guard_exact_doctoralia_appointment_duplicate;

ALTER TABLE public.doctoralia_appointments_ingestion
  ENABLE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row;

-- patient_classification: tabla pequeña, sin trigger problemático
UPDATE public.patient_classification
SET funnel_status_canonical = CASE
  WHEN funnel_status ILIKE '%asistio%'   OR funnel_status ILIKE '%realiz%'
    OR funnel_status ILIKE '%pagad%'     THEN 'asistio'
  WHEN funnel_status ILIKE '%no acude%' OR funnel_status ILIKE '%no_show%'
    OR funnel_status ILIKE '%ausente%'   THEN 'no_show'
  WHEN funnel_status ILIKE '%anulad%'   OR funnel_status ILIKE '%cancel%'
    THEN 'cancelado'
  WHEN funnel_status ILIKE '%lead%'     OR funnel_status ILIKE '%nuevo%'
    THEN 'lead'
  ELSE 'agendado'
END,
updated_at = NOW()
WHERE funnel_status_canonical IS NULL
  AND funnel_status IS NOT NULL;
