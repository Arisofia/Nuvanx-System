-- =============================================================================
-- Reset admin@nuvanx.com to a known temporary password.
--
-- Temporary password: Nuvanx2026!
-- CHANGE IT IMMEDIATELY after first login via the profile settings.
--
-- The hash below is bcrypt with 12 rounds.
-- Regenerate with:  node -e "require('bcryptjs').hash('YOUR_PW',12).then(console.log)"
-- =============================================================================

UPDATE users
SET    password_hash = '$2a$12$iEqdi0FYMHMdh5JnERgcmeYYx4f2ZUxIrTcNRaM1wjBzX3wBlntfC',
       updated_at    = NOW()
WHERE  email = 'admin@nuvanx.com';
