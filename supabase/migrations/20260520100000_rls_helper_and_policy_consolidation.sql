-- =============================================================================
-- Final RLS performance pass
-- - Standardize helper wrappers for auth identity lookups.
-- - Consolidate duplicate permissive SELECT policies on clinics/leads/whatsapp_conversations.
-- - Keep integrations unique index naming canonical.
-- =============================================================================

BEGIN;

-- Stable helper wrappers used by RLS policies.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.current_clinic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_claim_clinic uuid;
  v_user_clinic uuid;
BEGIN
  v_user_id := (SELECT auth.uid());
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_claim_clinic := ((SELECT auth.jwt()) ->> 'clinic_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_claim_clinic := NULL;
  END;

  IF v_claim_clinic IS NOT NULL THEN
    RETURN v_claim_clinic;
  END IF;

  IF to_regclass('public.users') IS NOT NULL THEN
    SELECT clinic_id INTO v_user_clinic FROM public.users WHERE id = v_user_id LIMIT 1;
    RETURN v_user_clinic;
  END IF;

  RETURN NULL;
END;
$$;

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
DO $$
BEGIN
  IF to_regclass('public.integrations_user_id_service_unique_idx') IS NOT NULL
     AND to_regclass('public.integrations_user_service_uq') IS NULL THEN
    EXECUTE 'ALTER INDEX public.integrations_user_id_service_unique_idx RENAME TO integrations_user_service_uq';
  END IF;
END $$;

COMMIT;
