-- FASE 5: Limpieza de índices de claves foráneas no utilizados (ADV_FK)
-- Estos índices fueron sugeridos por el asesor de seguridad para mejorar el rendimiento de DELETE,
-- pero el linter indica que no están siendo utilizados por ninguna consulta de búsqueda.

DROP INDEX IF EXISTS public.adv_fk_appointments_clinic_id;
DROP INDEX IF EXISTS public.adv_fk_appointments_doctor_id;
DROP INDEX IF EXISTS public.adv_fk_appointments_patient_id;
DROP INDEX IF EXISTS public.adv_fk_appointments_treatment_type_id;
DROP INDEX IF EXISTS public.adv_fk_credentials_clinic_id;
DROP INDEX IF EXISTS public.adv_fk_doctors_clinic_id;
DROP INDEX IF EXISTS public.adv_fk_kpi_values_kpi_id;
DROP INDEX IF EXISTS public.adv_fk_lead_scores_lead_id;
DROP INDEX IF EXISTS public.adv_fk_leads_assigned_to;
DROP INDEX IF EXISTS public.adv_fk_leads_doctor_id;
DROP INDEX IF EXISTS public.adv_fk_leads_treatment_type_id;
DROP INDEX IF EXISTS public.adv_fk_playbook_executions_agent_output_id;
DROP INDEX IF EXISTS public.adv_fk_playbooks_owner_user_id;
DROP INDEX IF EXISTS public.adv_fk_side_effect_locks_playbook_id;
DROP INDEX IF EXISTS public.adv_fk_treatment_types_clinic_id;
DROP INDEX IF EXISTS public.adv_fk_users_clinic_id;

-- Re-intento de endurecimiento de cron (si los permisos lo permiten)
DO $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
      EXECUTE 'REVOKE ALL ON TABLE cron.job FROM PUBLIC, anon';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_policy ON cron.job';
      EXECUTE 'CREATE POLICY cron_job_policy ON cron.job FOR ALL TO service_role USING (true) WITH CHECK (true)';
      
      EXECUTE 'REVOKE ALL ON TABLE cron.job_run_details FROM PUBLIC, anon';
      EXECUTE 'DROP POLICY IF EXISTS cron_job_run_details_policy ON cron.job_run_details';
      EXECUTE 'CREATE POLICY cron_job_run_details_policy ON cron.job_run_details FOR SELECT TO service_role USING (true)';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'No se pudo endurecer el esquema cron debido a falta de privilegios (común en Supabase Cloud)';
  END;
END $$;
