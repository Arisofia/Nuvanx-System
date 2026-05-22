-- add_ad_account_id_to_leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_account_id TEXT;
UPDATE leads SET ad_account_id = cuenta_id WHERE ad_account_id IS NULL AND cuenta_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leads_ad_account_id ON leads(ad_account_id) WHERE deleted_at IS NULL AND ad_account_id IS NOT NULL;
