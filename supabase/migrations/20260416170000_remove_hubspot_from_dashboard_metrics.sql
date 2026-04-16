-- =============================================================================
-- Remove HubSpot column from dashboard_metrics.
-- HubSpot integration was purged from the codebase in commit 12094c2.
-- Also refreshes the nuvanx-main KPI row with live counts.
-- =============================================================================

ALTER TABLE dashboard_metrics DROP COLUMN IF EXISTS hubspot_status;

UPDATE dashboard_metrics
SET
  total_leads            = (SELECT COUNT(*) FROM leads),
  connected_integrations = (SELECT COUNT(*) FROM integrations WHERE status = 'connected'),
  total_integrations     = (SELECT COUNT(*) FROM integrations),
  leads_lead             = (SELECT COUNT(*) FROM leads WHERE stage = 'lead'),
  leads_whatsapp         = (SELECT COUNT(*) FROM leads WHERE stage = 'whatsapp'),
  leads_appointment      = (SELECT COUNT(*) FROM leads WHERE stage = 'appointment'),
  leads_treatment        = (SELECT COUNT(*) FROM leads WHERE stage = 'treatment'),
  leads_closed           = (SELECT COUNT(*) FROM leads WHERE stage = 'closed'),
  updated_at             = NOW()
WHERE id = 'nuvanx-main';
