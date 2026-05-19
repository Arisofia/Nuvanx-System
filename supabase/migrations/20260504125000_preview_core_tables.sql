-- Compatibility no-op for Supabase Preview migration history.
--
-- This timestamp was briefly used by a preview-only compatibility migration and
-- may already exist in remote Preview migration history. Keep this file present
-- so Supabase can reconcile remote schema_migrations with the local migrations
-- directory. The actual missing-object hardening now lives in guarded migrations
-- such as 20260504130000_extend_vw_lead_traceability.sql and
-- 20260504140000_campaign_performance_source_and_user.sql.

DO $$
BEGIN
  RAISE NOTICE 'Compatibility no-op for migration 20260504125000';
END $$;
