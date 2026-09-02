-- Fail closed before the historical doctor performance view rebuild.
--
-- The following migration (20260901160000) preserves relation-level ACLs but
-- does not reconstruct per-column ACLs. A replay must therefore stop before
-- DROP VIEW if column grants exist, rather than silently losing privileges.

DO $$
DECLARE
  v_column_acl_count integer;
BEGIN
  IF to_regclass('public.vw_doctor_performance_real') IS NULL THEN
    RAISE EXCEPTION
      'Preflight failed: public.vw_doctor_performance_real is missing before canonical rebuild';
  END IF;

  SELECT count(*)
    INTO v_column_acl_count
  FROM pg_attribute AS a
  WHERE a.attrelid = 'public.vw_doctor_performance_real'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attacl IS NOT NULL;

  IF v_column_acl_count > 0 THEN
    RAISE EXCEPTION
      'Preflight failed: public.vw_doctor_performance_real has % column ACL entries; aborting rebuild because 20260901160000 does not preserve pg_attribute.attacl',
      v_column_acl_count;
  END IF;
END
$$;
