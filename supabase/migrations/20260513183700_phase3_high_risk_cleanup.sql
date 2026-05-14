-- FASE 3: Riesgo Alto - Ejecuta solo si estás seguro

-- Índices TRGM grandes de Meta (los más pesados)
DROP INDEX IF EXISTS public.meta_post_performance_message_trgm_idx;
DROP INDEX IF EXISTS public.meta_ig_media_performance_caption_trgm_idx;

-- Otros grandes / avanzados
DROP INDEX IF EXISTS public.idx_leads_clinic_phone_normalized;        -- (repetido por seguridad)
DROP INDEX IF EXISTS public.adv_fk_agent_run_steps_run_id;
DROP INDEX IF EXISTS public.adv_fk_agent_runs_execution_id;
DROP INDEX IF EXISTS public.adv_fk_agent_runs_playbook_id;
