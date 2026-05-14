-- FASE 1: Limpieza Segura - Índices de muy bajo riesgo y tamaño pequeño

-- WhatsApp (funcionalidad reciente y poco tráfico)
DROP INDEX IF EXISTS public.whatsapp_conversations_clinic_id_idx;
DROP INDEX IF EXISTS public.whatsapp_conversations_lead_id_idx;
DROP INDEX IF EXISTS public.whatsapp_conversations_clinic_sent_idx;

-- Agent outputs y playbooks
DROP INDEX IF EXISTS public.agent_outputs_clinic_id_idx;
DROP INDEX IF EXISTS public.agent_outputs_agent_type_idx;

-- Audit y logs internos
DROP INDEX IF EXISTS public.audit_log_resource_type_id_idx;
DROP INDEX IF EXISTS public.api_call_log_user_endpoint_idx;

-- Tablas auxiliares
DROP INDEX IF EXISTS public.patients_clinic_ltv_idx;
DROP INDEX IF EXISTS public.patients_name_normalized_idx;

-- Leads (índices secundarios)
DROP INDEX IF EXISTS public.leads_user_first_outbound_idx;
DROP INDEX IF EXISTS public.leads_user_first_inbound_idx;
DROP INDEX IF EXISTS public.leads_merged_into_idx;
DROP INDEX IF EXISTS public.idx_leads_priority;

-- Doctoralia / Settlements (secundarios)
DROP INDEX IF EXISTS public.settlements_template_patient_name_idx;
DROP INDEX IF EXISTS public.idx_doctoralia_lead_matches_lead_id_fk_cover;
DROP INDEX IF EXISTS public.idx_doctoralia_patients_clinic_id_fk_cover;
