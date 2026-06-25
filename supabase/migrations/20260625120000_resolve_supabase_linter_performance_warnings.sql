-- Resolve Supabase database-linter performance warnings reported on 2026-06-25.
-- Keeps policy intent unchanged while avoiding per-row auth initplans,
-- duplicate permissive policies, and duplicate index maintenance.

DO $$
BEGIN
  IF to_regclass('public.deck_progress') IS NOT NULL THEN
    DROP POLICY IF EXISTS deck_progress_select_own ON public.deck_progress;
    CREATE POLICY deck_progress_select_own ON public.deck_progress
      FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()::text));

    DROP POLICY IF EXISTS deck_progress_insert_own ON public.deck_progress;
    CREATE POLICY deck_progress_insert_own ON public.deck_progress
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = (SELECT auth.uid()::text));

    DROP POLICY IF EXISTS deck_progress_update_own ON public.deck_progress;
    CREATE POLICY deck_progress_update_own ON public.deck_progress
      FOR UPDATE
      TO authenticated
      USING (user_id = (SELECT auth.uid()::text))
      WITH CHECK (user_id = (SELECT auth.uid()::text));

    DROP POLICY IF EXISTS deck_progress_delete_own ON public.deck_progress;
    CREATE POLICY deck_progress_delete_own ON public.deck_progress
      FOR DELETE
      TO authenticated
      USING (user_id = (SELECT auth.uid()::text));
  ELSE
    RAISE NOTICE 'Skipping deck_progress linter policy rewrite: table does not exist';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.agent_outputs') IS NOT NULL THEN
    DROP POLICY IF EXISTS agent_outputs_insert_own ON public.agent_outputs;
    DROP POLICY IF EXISTS agent_outputs_insert ON public.agent_outputs;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agent_outputs'
        AND column_name = 'user_id'
    ) THEN
      CREATE POLICY agent_outputs_insert ON public.agent_outputs
        FOR INSERT
        TO authenticated
        WITH CHECK (
          COALESCE(((SELECT auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
          AND user_id = (SELECT auth.uid())
        );
    END IF;
  ELSE
    RAISE NOTICE 'Skipping agent_outputs INSERT policy consolidation: table does not exist';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.financial_settlements') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_financial_settlements ON public.financial_settlements;
  END IF;

  IF to_regclass('public.leads') IS NOT NULL THEN
    DROP POLICY IF EXISTS anon_select_dashboard_leads ON public.leads;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_meta_ig_account_daily_ig_id;
