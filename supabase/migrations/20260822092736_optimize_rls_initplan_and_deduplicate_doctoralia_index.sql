-- Resolve the Supabase RLS initplan warnings reported on 2026-08-22.
--
-- Every policy keeps its existing role, command and access condition. The only
-- change is evaluating stable auth/context helpers once per statement through a
-- scalar SELECT, rather than once for every candidate row. This migration also
-- removes the redundant, non-constraint phone_normalized index detected by the
-- Supabase database linter.
--
-- Production already had the nullable lineage columns below when this migration
-- was originally applied. They were schema drift rather than reproducible local
-- history, so restore them idempotently here before policies reference them.
-- On production this version is already applied and the columns already exist;
-- on a fresh preview this makes the historical migration self-contained.
ALTER TABLE public.lead_events
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS patient_id uuid;

ALTER TABLE public.patient_classification
  ADD COLUMN IF NOT EXISTS patient_id uuid;

DO $$
BEGIN
  IF to_regclass('public.credentials') IS NOT NULL THEN
    DROP POLICY IF EXISTS credentials_select_clinic ON public.credentials;
    CREATE POLICY credentials_select_clinic ON public.credentials
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;

  IF to_regclass('public.treatment_types') IS NOT NULL THEN
    DROP POLICY IF EXISTS treatment_types_select_clinic ON public.treatment_types;
    CREATE POLICY treatment_types_select_clinic ON public.treatment_types
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;

  IF to_regclass('public.whatsapp_conversations') IS NOT NULL THEN
    DROP POLICY IF EXISTS whatsapp_conversations_select_clinic ON public.whatsapp_conversations;
    CREATE POLICY whatsapp_conversations_select_clinic ON public.whatsapp_conversations
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;

  IF to_regclass('public.doctoralia_raw') IS NOT NULL THEN
    DROP POLICY IF EXISTS doctoralia_raw_select_clinic ON public.doctoralia_raw;
    CREATE POLICY doctoralia_raw_select_clinic ON public.doctoralia_raw
      FOR SELECT TO authenticated
      USING (COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE AND true);
  END IF;

  IF to_regclass('public.agent_outputs') IS NOT NULL THEN
    DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs;
    CREATE POLICY agent_outputs_insert ON public.agent_outputs
      FOR INSERT TO authenticated
      WITH CHECK (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())
      );
  END IF;

  IF to_regclass('public.doctoralia_patients') IS NOT NULL THEN
    DROP POLICY IF EXISTS doctoralia_patients_select_clinic ON public.doctoralia_patients;
    CREATE POLICY doctoralia_patients_select_clinic ON public.doctoralia_patients
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND clinic_id = (SELECT public.current_clinic_id())
      );
  END IF;

  IF to_regclass('public.doctoralia_appointments_raw') IS NOT NULL THEN
    DROP POLICY IF EXISTS doctoralia_appointments_raw_select_clinic ON public.doctoralia_appointments_raw;
    CREATE POLICY doctoralia_appointments_raw_select_clinic ON public.doctoralia_appointments_raw
      FOR SELECT TO authenticated
      USING (COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE AND true);
  END IF;

  IF to_regclass('public.doctoralia_appointments_ingestion') IS NOT NULL THEN
    DROP POLICY IF EXISTS doctoralia_appointments_ingestion_select_clinic ON public.doctoralia_appointments_ingestion;
    CREATE POLICY doctoralia_appointments_ingestion_select_clinic ON public.doctoralia_appointments_ingestion
      FOR SELECT TO authenticated
      USING (COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE AND true);
  END IF;

  IF to_regclass('public.posts') IS NOT NULL THEN
    DROP POLICY IF EXISTS posts_delete_own ON public.posts;
    CREATE POLICY posts_delete_own ON public.posts
      FOR DELETE TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())
      );

    DROP POLICY IF EXISTS posts_update_own ON public.posts;
    CREATE POLICY posts_update_own ON public.posts
      FOR UPDATE TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())
      )
      WITH CHECK (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())
      );
  END IF;

  IF to_regclass('public.deck_progress') IS NOT NULL THEN
    DROP POLICY IF EXISTS deck_progress_delete_own ON public.deck_progress;
    CREATE POLICY deck_progress_delete_own ON public.deck_progress
      FOR DELETE TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())::text
      );

    DROP POLICY IF EXISTS deck_progress_insert_own ON public.deck_progress;
    CREATE POLICY deck_progress_insert_own ON public.deck_progress
      FOR INSERT TO authenticated
      WITH CHECK (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())::text
      );

    DROP POLICY IF EXISTS deck_progress_select_own ON public.deck_progress;
    CREATE POLICY deck_progress_select_own ON public.deck_progress
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())::text
      );

    DROP POLICY IF EXISTS deck_progress_update_own ON public.deck_progress;
    CREATE POLICY deck_progress_update_own ON public.deck_progress
      FOR UPDATE TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())::text
      )
      WITH CHECK (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND user_id = (SELECT auth.uid())::text
      );
  END IF;

  IF to_regclass('public.lead_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS lead_events_select_own_clinic ON public.lead_events;
    CREATE POLICY lead_events_select_own_clinic ON public.lead_events
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND EXISTS (
          SELECT 1
          FROM public.leads l
          WHERE l.id = lead_events.lead_id
            AND l.clinic_id = (SELECT public.current_clinic_id())
        )
      );
  END IF;

  IF to_regclass('public.patient_classification') IS NOT NULL THEN
    DROP POLICY IF EXISTS patient_classification_select_own_clinic ON public.patient_classification;
    CREATE POLICY patient_classification_select_own_clinic ON public.patient_classification
      FOR SELECT TO authenticated
      USING (
        COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
        AND (
          (lead_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.leads l
            WHERE l.id = patient_classification.lead_id
              AND l.clinic_id = (SELECT public.current_clinic_id())
          ))
          OR
          (lead_id IS NULL AND patient_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM public.patients p
            WHERE p.id = patient_classification.patient_id
              AND p.clinic_id = (SELECT public.current_clinic_id())
          ))
        )
      );
  END IF;
END $$;

-- Both indexes have the exact same btree definition on phone_normalized. Keep
-- the descriptive, table-qualified name and remove the generic duplicate.
DROP INDEX IF EXISTS public.idx_doctoralia_ingestion_phone_normalized;
