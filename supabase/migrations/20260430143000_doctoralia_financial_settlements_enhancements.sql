-- Add operational fields for Doctoralia financial ingestion
-- 20260430143000_doctoralia_financial_settlements_enhancements.sql

ALTER TABLE public.financial_settlements
  ADD COLUMN IF NOT EXISTS status_original VARCHAR(128),
  ADD COLUMN IF NOT EXISTS status_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS room_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS lead_source VARCHAR(128),
  ADD COLUMN IF NOT EXISTS agenda_name VARCHAR(128);
