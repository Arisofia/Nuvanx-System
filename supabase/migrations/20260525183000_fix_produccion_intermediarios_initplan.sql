BEGIN;

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
            SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.is_anonymous', true), ''), 'false')
          ) <> 'true'
          AND clinic_id = (SELECT public.current_clinic_id())
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping produccion_intermediarios_select initplan rewrite because public.produccion_intermediarios or clinic_id is missing';
  END IF;
END $$;

COMMIT;
