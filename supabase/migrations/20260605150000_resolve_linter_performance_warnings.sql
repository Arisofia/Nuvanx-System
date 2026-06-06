-- 20260605150000_resolve_linter_performance_warnings.sql
--
-- Resolves Supabase Advisor performance warnings:
-- 1. [PERFORMANCE] auth_rls_initplan: Wrap auth functions in (SELECT ...)
-- 2. [PERFORMANCE] multiple_permissive_policies: Consolidate redundant policies
--
-- Tables: clinics, agent_outputs, api_call_log, meta_daily_insights,
-- meta_organic_daily, meta_post_performance, meta_ig_account_daily,
-- meta_ig_media_performance, produccion_intermediarios.

BEGIN;

-- 1. clinics: Fix initplan for select
DROP POLICY IF EXISTS clinics_select ON public.clinics;
CREATE POLICY clinics_select ON public.clinics
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND id = (SELECT public.current_clinic_id())
  );

-- 2. agent_outputs: Consolidate INSERT and fix SELECT initplan
-- Fixes multiple_permissive_policies (agent_outputs_insert, agent_outputs_insert_own)
DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs;
DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
CREATE POLICY agent_outputs_insert ON public.agent_outputs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND (
      (SELECT auth.uid()) = user_id 
      OR (SELECT auth.role()) = 'service_role'
    )
  );

DROP POLICY IF EXISTS agent_outputs_select_clinic ON public.agent_outputs;
CREATE POLICY agent_outputs_select_clinic ON public.agent_outputs
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- 3. api_call_log: Fix initplan
DROP POLICY IF EXISTS api_call_log_select_own ON public.api_call_log;
CREATE POLICY api_call_log_select_own ON public.api_call_log
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND (SELECT auth.uid()) = user_id
  );

-- 4. meta_daily_insights: Consolidate SELECT and fix initplan
-- Fixes multiple_permissive_policies (meta_daily_insights_select_clinic, meta_daily_insights_select_own)
DROP POLICY IF EXISTS meta_daily_insights_select_clinic ON public.meta_daily_insights;
DROP POLICY IF EXISTS meta_daily_insights_select_own ON public.meta_daily_insights;
DROP POLICY IF EXISTS meta_daily_insights_select ON public.meta_daily_insights;
CREATE POLICY meta_daily_insights_select ON public.meta_daily_insights
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- 5. Fix remaining Meta performance warnings (initplan)

-- meta_organic_daily
DROP POLICY IF EXISTS meta_organic_daily_select_clinic ON public.meta_organic_daily;
DROP POLICY IF EXISTS meta_organic_daily_select ON public.meta_organic_daily;
CREATE POLICY meta_organic_daily_select ON public.meta_organic_daily
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- meta_post_performance
DROP POLICY IF EXISTS meta_post_performance_select_clinic ON public.meta_post_performance;
DROP POLICY IF EXISTS meta_post_performance_select ON public.meta_post_performance;
CREATE POLICY meta_post_performance_select ON public.meta_post_performance
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- meta_ig_account_daily
DROP POLICY IF EXISTS meta_ig_account_daily_select_clinic ON public.meta_ig_account_daily;
DROP POLICY IF EXISTS meta_ig_account_daily_select ON public.meta_ig_account_daily;
CREATE POLICY meta_ig_account_daily_select ON public.meta_ig_account_daily
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- meta_ig_media_performance
DROP POLICY IF EXISTS meta_ig_media_performance_select_clinic ON public.meta_ig_media_performance;
DROP POLICY IF EXISTS meta_ig_media_performance_select ON public.meta_ig_media_performance;
CREATE POLICY meta_ig_media_performance_select ON public.meta_ig_media_performance
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

-- 6. produccion_intermediarios: Fix initplan
DROP POLICY IF EXISTS produccion_intermediarios_select_clinic ON public.produccion_intermediarios;
DROP POLICY IF EXISTS produccion_intermediarios_select ON public.produccion_intermediarios;
CREATE POLICY produccion_intermediarios_select ON public.produccion_intermediarios
  FOR SELECT TO authenticated
  USING (
    (SELECT (auth.jwt() ->> 'is_anonymous')) IS DISTINCT FROM 'true'
    AND clinic_id = (SELECT public.current_clinic_id())
  );

COMMIT;