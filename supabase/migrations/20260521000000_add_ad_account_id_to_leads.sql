-- 20260521000000_add_ad_account_id_to_leads.sql
-- Restored migration file to preserve remote/local migration history continuity.
-- This migration may already be applied in remote environments.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ad_account_id TEXT;
