-- FASE 4: Limpieza Adicional de Índices no utilizados (según linter)

DROP INDEX IF EXISTS public.credentials_service_user_idx;
DROP INDEX IF EXISTS public.idx_doctoralia_raw_paciente_telefono;
DROP INDEX IF EXISTS public.idx_lead_timeline_events_lead_id_fk_cover;
