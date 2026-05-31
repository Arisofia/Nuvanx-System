BEGIN;

-- Sole owner for produccion_intermediarios_select in this hardening series.
-- Uses current_setting through a scalar subquery to satisfy auth_rls_initplan.
DO $$
DECLARE
  target_table regclass := to_regclass('public.produccion_intermediarios');
BEGIN
  IF target_table IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_attribute
       WHERE attrelid = target_table
         AND attname = 'clinic_id'
         AND attnum > 0
         AND NOT attisdropped
     ) THEN
    EXECUTE 'DROP POLICY IF EXISTS produccion_intermediarios_select ON public.produccion_intermediarios';
    EXECUTE $policy$
      CREATE POLICY produccion_intermediarios_select ON public.produccion_intermediarios
        FOR SELECT TO authenticated
        USING (
          (
            SELECT CASE lower(NULLIF(current_setting('request.jwt.claim.is_anonymous', true), ''))
              WHEN 'false' THEN false
              WHEN 'f' THEN false
              WHEN '0' THEN false
              WHEN 'no' THEN false
              WHEN 'off' THEN false
              WHEN 'true' THEN true
              WHEN 't' THEN true
              WHEN '1' THEN true
              WHEN 'yes' THEN true
              WHEN 'on' THEN true
              ELSE true
            END
          ) IS NOT TRUE
          AND clinic_id = (SELECT public.current_clinic_id())
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping produccion_intermediarios_select initplan rewrite because public.produccion_intermediarios or clinic_id is missing';
  END IF;
END $$;

COMMIT;
