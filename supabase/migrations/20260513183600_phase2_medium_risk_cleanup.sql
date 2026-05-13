-- FASE 2: Riesgo Medio

-- Leads (índices de normalización y búsqueda)
DROP INDEX IF EXISTS public.leads_name_normalized_idx;
DROP INDEX IF EXISTS public.idx_leads_phone_normalized;
DROP INDEX IF EXISTS public.idx_leads_clinic_phone_normalized;

-- Financial Settlements y Doctoralia (secundarios)
DROP INDEX IF EXISTS public.idx_financial_settlements_phone_normalized;
DROP INDEX IF EXISTS public.idx_financial_settlements_clinic_phone_normalized;
DROP INDEX IF EXISTS public.idx_doctoralia_patients_phone_normalized;

-- Otros de tamaño medio
DROP INDEX IF EXISTS public.doctoralia_raw_clinic_id_idx;
DROP INDEX IF EXISTS public.doctoralia_raw_upload_id_idx;
DROP INDEX IF EXISTS public.doctoralia_raw_unprocessed_idx;
DROP INDEX IF EXISTS public.doctoralia_raw_intermediarios_kpis_idx;
