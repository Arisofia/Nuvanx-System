-- =============================================================================
-- Migration 016: Purge seed/test data and reset lying statuses
-- Mirrors supabase/migrations/20260417120000_purge_test_data.sql
-- =============================================================================

-- 1. Delete fake leads with no contact info
DELETE FROM leads
WHERE (phone IS NULL OR phone = '')
  AND (email IS NULL OR email = '');

-- 2. Reset integrations to "disconnected" when no credential exists
UPDATE integrations
SET status = 'disconnected',
    last_sync = NULL,
    last_error = 'reset: no matching credential found',
    updated_at = NOW()
WHERE status = 'connected'
  AND NOT EXISTS (
    SELECT 1 FROM credentials c
    WHERE c.user_id = integrations.user_id
      AND c.service = integrations.service
  );

-- 3. Reset dashboard_metrics to zeros
UPDATE dashboard_metrics
SET total_leads            = 0,
    total_revenue          = 0.00,
    connected_integrations = 0,
    leads_lead             = 0,
    leads_whatsapp         = 0,
    leads_appointment      = 0,
    leads_treatment        = 0,
    leads_closed           = 0,
    meta_status            = 'disconnected',
    whatsapp_status        = 'disconnected',
    github_status          = 'disconnected',
    openai_status          = 'disconnected',
    gemini_status          = 'disconnected',
    last_sync              = NOW(),
    updated_at             = NOW()
WHERE id = 'nuvanx-main';

-- 4. Clean seed artifacts from audit_log
DELETE FROM audit_log
WHERE action IN ('seed_data', 'migration_cleanup');
