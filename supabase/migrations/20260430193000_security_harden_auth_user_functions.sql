-- Security hardening for auth sync trigger functions
-- Fixes Supabase DB lint warnings for mutable function search_path and public EXECUTE on SECURITY DEFINER functions.

-- 1. Lock function search_path
ALTER FUNCTION public.handle_new_auth_user() SET search_path TO pg_catalog, public;
ALTER FUNCTION public.handle_auth_user_change() SET search_path TO pg_catalog, public;

-- 2. Revoke public execution for trigger-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_change() FROM anon, authenticated;
