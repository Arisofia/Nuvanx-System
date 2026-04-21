-- Add priority field to leads for keyword-based triage
-- Values: 'high' (contains trigger keywords) | 'normal' (default)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS priority VARCHAR(16) NOT NULL DEFAULT 'normal';

CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(user_id, priority) WHERE priority = 'high';
