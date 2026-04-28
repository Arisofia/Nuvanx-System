-- =============================================================================
-- Supabase migration: Synchronize auth.users with public.users
-- Ensures that users created via Supabase Auth are automatically added to
-- the public.users table so they can be linked to clinics and have 
-- associated data (leads, credentials, etc.)
-- =============================================================================

-- 1. Make password_hash nullable
-- Supabase-managed users do not have a local password hash in our table.
ALTER TABLE public.users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Create the sync function
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, password_hash)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 4. Backfill existing users
-- In case there are already users in auth.users that are not in public.users
INSERT INTO public.users (id, email, name, password_hash)
SELECT 
  id, 
  email, 
  COALESCE(raw_user_meta_data->>'name', email),
  NULL
FROM auth.users
ON CONFLICT (id) DO NOTHING;
