
-- Bridge: enlaza doctoralia_appointments_ingestion con la tabla canónica doctors
-- Añade doctor_id FK para resolver el médico que atendió cada cita Doctoralia

ALTER TABLE public.doctoralia_appointments_ingestion
  ADD COLUMN IF NOT EXISTS doctor_id uuid
    REFERENCES public.doctors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doctoralia_ingestion_doctor_id
  ON public.doctoralia_appointments_ingestion (doctor_id)
  WHERE doctor_id IS NOT NULL;

-- Backfill: citas marcadas is_jjrt → Dr. José Javier Rivera Tejeda
-- Resuelve por clínica usando el campo clinic del registro
UPDATE public.doctoralia_appointments_ingestion dai
SET doctor_id = d.id
FROM public.doctors d
WHERE dai.is_jjrt = true
  AND d.name ILIKE '%Rivera Tejeda%'
  AND (
    (dai.clinic ILIKE '%chamberí%' AND d.clinic_id = '4207023b-eac1-4249-bf0f-d9b1e36a5d7a')
    OR
    (dai.clinic NOT ILIKE '%chamberí%' AND d.clinic_id = 'b107023b-eac1-4249-bf0f-d9b1e36a5d7b')
  )
  AND dai.doctor_id IS NULL;

COMMENT ON COLUMN public.doctoralia_appointments_ingestion.doctor_id IS
  'FK al médico canónico en public.doctors. Resuelto desde is_jjrt/agenda. NULL = sin resolver.';
