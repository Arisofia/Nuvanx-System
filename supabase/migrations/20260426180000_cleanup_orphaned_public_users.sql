-- Cleanup orphaned public.users rows that no longer have a matching auth.users entry.
-- Also add a trigger to keep public.users synchronized with auth.users on INSERT, UPDATE, DELETE.

CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.users WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.users (id, email, name, password_hash, clinic_id, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'managed_by_supabase',
    (SELECT id FROM public.clinics LIMIT 1),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_changed ON auth.users;
CREATE TRIGGER on_auth_user_changed
  AFTER INSERT OR UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_change();

DELETE FROM public.users u
WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id);
