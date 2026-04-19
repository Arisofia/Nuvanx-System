-- Superseded by later targeted advisor migrations.
-- This migration is intentionally a no-op to keep migration ordering intact
-- and avoid non-transactional DDL incompatibilities in remote pipeline mode.
SELECT 1;
