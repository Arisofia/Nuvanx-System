-- =============================================================================
-- RLS Helper and Policy Consolidation (2026-05-20) - SIMPLIFIED
-- =============================================================================
--
-- Revisión 2026-05-31 (Revisión #5 y #9):
-- - Se eliminó la redefinición duplicada de current_clinic_id() y current_user_id().
--   Estas funciones ahora se mantienen de forma consolidada en 20260531000010.
-- - Esta migración queda como un paso intermedio histórico.
-- - Su valor real se limita a la consolidación de políticas en clinics, leads y whatsapp_conversations.
-- - Muchas de las políticas que crea aquí probablemente fueron sobrescritas o mejoradas
--   en 20260530000000_comprehensive_rls_fix.sql.
--
-- Decisión: Se mantiene simplificada. No se recomienda depender de ella para
-- el estado actual de las políticas.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  -- clinics: merge duplicate permissive SELECT policies into one.
  IF to_regclass('public.clinics') IS NOT NULL THEN
    DROP POLICY IF EXISTS clinics_select_clinic ON public.clinics;
    DROP POLICY IF EXISTS clinics_select_own ON public.clinics;
    DROP POLICY IF EXISTS clinics_select ON public.clinics;

    CREATE POLICY clinics_select ON public.clinics
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND id = (SELECT public.current_clinic_id())
      );
  END IF;

  -- leads: merge duplicate permissive SELECT policies into one clinic-scoped policy.
  IF to_regclass('public.leads') IS NOT NULL THEN
    DROP POLICY IF EXISTS leads_select_authenticated ON public.leads;
    DROP POLICY IF EXISTS leads_select_clinic ON public.leads;
    DROP POLICY IF EXISTS leads_select ON public.leads;

    CREATE POLICY leads_select ON public.leads
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;

  -- whatsapp_conversations: merge overlapping SELECT policies.
  IF to_regclass('public.whatsapp_conversations') IS NOT NULL THEN
    DROP POLICY IF EXISTS wa_conv_clinic_select ON public.whatsapp_conversations;
    DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON public.whatsapp_conversations;
    DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;

    CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
      FOR SELECT TO authenticated
      USING (
        (SELECT auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;
END $$;

-- Optional naming cleanup for the canonical integrations unique index.
-- (Minor operation - likely already applied or superseded in later migrations)
DO $$
BEGIN
  IF to_regclass('public.integrations_user_id_service_unique_idx') IS NOT NULL
     AND to_regclass('public.integrations_user_service_uq') IS NULL THEN
    EXECUTE 'ALTER INDEX public.integrations_user_id_service_unique_idx RENAME TO integrations_user_service_uq';
  END IF;
END $$;

COMMIT;
