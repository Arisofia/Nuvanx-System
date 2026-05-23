-- Restore correct ad account id `act_9523446201036125` for Francisco's integration.
-- The previous migration mistakenly identified it as stale/inaccessible, 
-- but it is the account containing active campaigns and valid leads.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integrations') THEN
    UPDATE public.integrations
    SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{adAccountId}', '"act_9523446201036125"'::jsonb)
    WHERE service = 'meta'
      AND (
        metadata->>'adAccountId' = 'act_4172099716404860' 
        OR user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a'
      );
    RAISE NOTICE 'Cuenta de Francisco Antonio restaurada en integrations.';
  ELSE
    RAISE NOTICE 'La tabla integrations no existe, saltando actualización.';
  END IF;
END $$;
