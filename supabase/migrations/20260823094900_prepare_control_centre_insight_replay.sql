-- Deployment compatibility shim for the still-pending
-- 20260823095000_control_centre_live_and_daily_insight.sql migration.
--
-- Production has already applied 20260823094500 and 20260823094700, while
-- 20260823095000 has never been recorded because its transaction rolled back.
-- That pending migration references financial_settlements.campaign_name even
-- though the legacy table does not expose that column. Add a nullable field only
-- so the historical pending migration can replay atomically. A following
-- migration replaces the affected function with the canonical non-cash
-- semantics and removes this compatibility field again.

ALTER TABLE IF EXISTS public.financial_settlements
  ADD COLUMN IF NOT EXISTS campaign_name text;

COMMENT ON COLUMN public.financial_settlements.campaign_name IS
  'Temporary deployment compatibility field for 20260823095000 replay; not an attribution or reconciled-cash source.';
