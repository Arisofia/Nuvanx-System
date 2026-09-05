-- 20260905144500_reconcile_auth_user_profile_mirror.sql
--
-- Production already carries an unversioned auth.users -> public.users trigger.
-- Version that ownership so fresh Preview/Production replays have the same
-- transactional identity-mirror boundary and Edge code does not need a
-- service-role compensation path.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name TEXT;

CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_default_clinic_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.users WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  -- Preserve the legacy single-clinic bootstrap without assigning an arbitrary
  -- clinic in a multi-clinic environment.
  SELECT c.id
    INTO v_default_clinic_id
    FROM public.clinics c
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.clinics other
      WHERE other.id <> c.id
   )
   LIMIT 1;

  INSERT INTO public.users (
    id,
    email,
    name,
    clinic_id,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), ''),
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    v_default_clinic_id,
    COALESCE(NEW.created_at, NOW()),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, public.users.name),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_changed ON auth.users;
CREATE TRIGGER on_auth_user_changed
AFTER INSERT OR DELETE OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_change();
