-- Fix remaining Supabase advisor warnings (auth_rls_initplan and missing clinic scoping)
-- for Meta organic and IG tables. - 24 May 2026

BEGIN;

-- 1) meta_organic_daily
ALTER TABLE public.meta_organic_daily
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.meta_organic_daily m
SET clinic_id = u.clinic_id
FROM public.users u
WHERE m.user_id = u.id AND m.clinic_id IS NULL AND u.clinic_id IS NOT NULL;

DROP POLICY IF EXISTS meta_organic_daily_select_own ON public.meta_organic_daily;
CREATE POLICY meta_organic_daily_select ON public.meta_organic_daily
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));

DROP POLICY IF EXISTS meta_organic_daily_service_role ON public.meta_organic_daily;
CREATE POLICY meta_organic_daily_service_role ON public.meta_organic_daily
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 2) meta_post_performance
ALTER TABLE public.meta_post_performance
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.meta_post_performance m
SET clinic_id = u.clinic_id
FROM public.users u
WHERE m.user_id = u.id AND m.clinic_id IS NULL AND u.clinic_id IS NOT NULL;

DROP POLICY IF EXISTS meta_post_performance_select_own ON public.meta_post_performance;
CREATE POLICY meta_post_performance_select ON public.meta_post_performance
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));

DROP POLICY IF EXISTS meta_post_performance_service_role ON public.meta_post_performance;
CREATE POLICY meta_post_performance_service_role ON public.meta_post_performance
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 3) meta_ig_account_daily
ALTER TABLE public.meta_ig_account_daily
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.meta_ig_account_daily m
SET clinic_id = u.clinic_id
FROM public.users u
WHERE m.user_id = u.id AND m.clinic_id IS NULL AND u.clinic_id IS NOT NULL;

DROP POLICY IF EXISTS meta_ig_account_daily_select_own ON public.meta_ig_account_daily;
CREATE POLICY meta_ig_account_daily_select ON public.meta_ig_account_daily
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));

DROP POLICY IF EXISTS meta_ig_account_daily_service_role ON public.meta_ig_account_daily;
CREATE POLICY meta_ig_account_daily_service_role ON public.meta_ig_account_daily
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 4) meta_ig_media_performance
ALTER TABLE public.meta_ig_media_performance
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE;

UPDATE public.meta_ig_media_performance m
SET clinic_id = u.clinic_id
FROM public.users u
WHERE m.user_id = u.id AND m.clinic_id IS NULL AND u.clinic_id IS NOT NULL;

DROP POLICY IF EXISTS meta_ig_media_performance_select_own ON public.meta_ig_media_performance;
CREATE POLICY meta_ig_media_performance_select ON public.meta_ig_media_performance
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));

DROP POLICY IF EXISTS meta_ig_media_performance_service_role ON public.meta_ig_media_performance;
CREATE POLICY meta_ig_media_performance_service_role ON public.meta_ig_media_performance
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 5) meta_daily_insights (Harden existing policies with initplan pattern)
DROP POLICY IF EXISTS meta_daily_insights_select_own ON public.meta_daily_insights;
CREATE POLICY meta_daily_insights_select ON public.meta_daily_insights
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL AND clinic_id = (SELECT public.current_clinic_id()));

DROP POLICY IF EXISTS meta_daily_insights_service_role ON public.meta_daily_insights;
CREATE POLICY meta_daily_insights_service_role ON public.meta_daily_insights
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- 6) produccion_intermediarios (Scope to clinic)
DROP POLICY IF EXISTS produccion_intermediarios_authenticated_select ON public.produccion_intermediarios;
CREATE POLICY produccion_intermediarios_select ON public.produccion_intermediarios
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL 
    AND (
      clinic_id = (SELECT public.current_clinic_id())
      OR (SELECT auth.jwt() ->> 'role') = 'service_role'
    )
  );

DROP POLICY IF EXISTS produccion_intermediarios_service_role_all ON public.produccion_intermediarios;
CREATE POLICY produccion_intermediarios_service_role ON public.produccion_intermediarios
  FOR ALL TO service_role
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

COMMIT;
