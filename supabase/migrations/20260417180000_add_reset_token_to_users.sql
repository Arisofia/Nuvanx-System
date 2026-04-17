-- Add password-reset token columns to users table.
-- Stores the token in the DB so it survives server restarts and works
-- across multiple Railway replicas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

-- Index for quick lookup by token during POST /api/auth/reset-password.
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token) WHERE reset_token IS NOT NULL;
