-- Clean up malformed migration entries from schema_migrations table
-- These entries are blocking supabase db pull and have no corresponding files

-- Remove the malformed migration entries
DELETE FROM supabase_migrations.schema_migrations
WHERE version IN ('202606081440', '20260609');

-- Verify the deletion
SELECT COUNT(*) as remaining_migrations
FROM supabase_migrations.schema_migrations;

-- List the last 10 migrations to confirm they look valid
SELECT version 
FROM supabase_migrations.schema_migrations 
ORDER BY version DESC 
LIMIT 10;
