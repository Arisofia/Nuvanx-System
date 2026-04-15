-- =============================================================================
-- Migration 004: playbooks and playbook_executions tables
-- =============================================================================
-- Playbook definitions are seeded from the product (they are workflow templates),
-- so the table holds the canonical list.  Execution tracking lives in
-- playbook_executions and is written on every POST /api/playbooks/:id/run.
-- =============================================================================

-- Playbook definition catalogue
CREATE TABLE IF NOT EXISTS public.playbooks (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT          NOT NULL UNIQUE,
  title        TEXT          NOT NULL,
  description  TEXT          NOT NULL DEFAULT '',
  category     TEXT          NOT NULL DEFAULT 'General',
  status       TEXT          NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('active', 'draft', 'archived')),
  steps        JSONB         NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Execution log — one row per run attempt
CREATE TABLE IF NOT EXISTS public.playbook_executions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id   UUID          NOT NULL REFERENCES public.playbooks(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'success'
                              CHECK (status IN ('success', 'failed', 'skipped')),
  metadata      JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playbook_executions_playbook_id_idx ON public.playbook_executions(playbook_id);
CREATE INDEX IF NOT EXISTS playbook_executions_user_id_idx     ON public.playbook_executions(user_id);
CREATE INDEX IF NOT EXISTS playbook_executions_created_at_idx  ON public.playbook_executions(created_at DESC);

-- Row-level security
ALTER TABLE public.playbooks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playbook_executions  ENABLE ROW LEVEL SECURITY;

-- Playbook definitions are readable by all authenticated users
DROP POLICY IF EXISTS playbooks_read ON public.playbooks;
CREATE POLICY playbooks_read ON public.playbooks
  FOR SELECT USING (TRUE);

-- Executions are scoped per user
DROP POLICY IF EXISTS playbook_executions_user ON public.playbook_executions;
CREATE POLICY playbook_executions_user ON public.playbook_executions
  FOR ALL USING (user_id = auth.uid());

-- Service-role bypass for backend writes
DROP POLICY IF EXISTS playbooks_service_role ON public.playbooks;
CREATE POLICY playbooks_service_role ON public.playbooks
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS playbook_executions_service_role ON public.playbook_executions;
CREATE POLICY playbook_executions_service_role ON public.playbook_executions
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─── Seed product playbooks ────────────────────────────────────────────────
INSERT INTO public.playbooks (slug, title, description, category, status, steps) VALUES
  (
    'lead-capture-nurture',
    'Lead Capture & Nurture',
    'Automate the journey from Meta Ads click to WhatsApp conversation — capture, qualify, and nurture every lead.',
    'Acquisition',
    'active',
    '["Meta Ads Lead Form triggers webhook","Lead data synced to CRM automatically","WhatsApp welcome message sent within 2 min","AI qualifies lead with 3-question sequence","Appointment booking link sent to qualified leads"]'
  ),
  (
    'appointment-followup',
    'Appointment Follow-up',
    'Post-consultation and post-treatment automated follow-up sequence to maximize satisfaction and upsells.',
    'Retention',
    'active',
    '["Treatment completion recorded in system","Satisfaction survey sent 24h after","Personalized care instructions via WhatsApp","Upsell offer for complementary treatment at day 7","Monthly check-in message at day 30"]'
  ),
  (
    'reengagement-campaign',
    'Re-engagement Campaign',
    'Reactivate dormant clients who haven''t booked in 60+ days with personalized offers.',
    'Reactivation',
    'active',
    '["Identify clients inactive for 60+ days","Segment by last treatment type","Send personalized reactivation email","WhatsApp follow-up after 48h if no open","Exclusive 15% discount offer at day 5"]'
  ),
  (
    'seasonal-promotion',
    'Seasonal Promotion',
    'Launch holiday and seasonal campaigns with AI-generated copy tailored to your audience segments.',
    'Campaigns',
    'draft',
    '["Select promotion type and dates","AI generates campaign copy variants","A/B test on 10% of audience first","Winning variant broadcast to full list","Performance report generated automatically"]'
  ),
  (
    'referral-program',
    'Referral Program',
    'Systematically turn happy clients into brand ambassadors with a tracked referral automation flow.',
    'Growth',
    'active',
    '["Identify clients with NPS score 9-10","Send referral invite with unique tracking link","Reward notification when referral books","Thank-you message and reward delivery","Monthly leaderboard for top referrers"]'
  ),
  (
    'review-generation',
    'Review Generation',
    'Automate post-treatment review requests to Google and social platforms at the optimal timing.',
    'Reputation',
    'draft',
    '["Treatment marked complete in CRM","Wait 48h for experience to settle","Send personalized review request","If no action at 72h, send WhatsApp reminder","Flag negative reviews for immediate follow-up"]'
  )
ON CONFLICT (slug) DO UPDATE SET
  title       = EXCLUDED.title,
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  status      = EXCLUDED.status,
  steps       = EXCLUDED.steps,
  updated_at  = NOW();
