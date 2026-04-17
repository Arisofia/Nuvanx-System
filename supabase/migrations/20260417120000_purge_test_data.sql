-- =============================================================================
-- Migration: Purge seed/test data and reset lying statuses
--
-- Problem: The database contains artifacts from seed scripts and test runs
-- that create a false picture of the system state:
--   - 4 fake leads with empty phone/email and zero revenue
--   - 7 integrations marked "connected" with 0 matching credentials
--   - dashboard_metrics row with stale numbers (total_leads=4, connected=7)
--   - audit_log entries from seed scripts
--
-- This migration resets the database to an honest empty state ready for
-- real production data.
-- =============================================================================

-- 1. Delete all fake/test leads (phone='' AND email='' means they have
--    no real contact info — they came from seed scripts or broken webhooks)
DELETE FROM leads
WHERE (phone IS NULL OR phone = '')
  AND (email IS NULL OR email = '');

-- 2. Reset all integrations to "disconnected" when no matching credential
--    exists. An integration can only honestly be "connected" if the user
--    has stored real API credentials for it.
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

-- 3. Reset dashboard_metrics to zeros so it reflects reality.
--    The periodic sync (figmaSync / dashboardSync) will recompute
--    correct values on the next cycle.
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
