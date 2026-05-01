-- =============================================================================
-- Supabase migration: Create clinics table + FK from users.clinic_id
-- =============================================================================

CREATE TABLE IF NOT EXISTS clinics (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(128) NOT NULL UNIQUE,
  timezone   VARCHAR(64)  NOT NULL DEFAULT 'America/New_York',
  metadata   JSONB        NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;

-- Drop the policy from the earlier fix migration (it may or may not exist)
DROP POLICY IF EXISTS clinics_select_own ON clinics;
DROP POLICY IF EXISTS clinics_service_role ON clinics;

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinics_select_own ON clinics
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT u.clinic_id FROM users u WHERE u.id = auth.uid())
  );

CREATE TRIGGER set_clinics_updated_at
  BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_clinic_id_fkey'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_clinic_id_fkey
      FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_clinic_id_idx ON users(clinic_id);
