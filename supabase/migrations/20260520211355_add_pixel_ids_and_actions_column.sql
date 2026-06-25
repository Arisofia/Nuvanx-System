-- add_pixel_ids_and_actions_column
-- Canonical Meta Pixel / Dataset: 1497940655079106
-- Deprecated pixel 1405503384615251 must not be reintroduced by fresh database builds.
DO $$
BEGIN
  -- 1. Actualización de integrations
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integrations') THEN
    UPDATE public.integrations
    SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(metadata, '{pixelId}', '"1497940655079106"'),
            '{pixel_id}', '"1497940655079106"'
          ),
          '{pixelIdGoya}', '"1497940655079106"'
        ),
        '{pixelIdChamberi}', '"1497940655079106"'
      ),
      '{adAccountIdGoya}', '"act_9523446201036125"'
    )
    WHERE service = 'meta';
  ELSE
    RAISE NOTICE 'La tabla integrations no existe, saltando actualización de píxeles.';
  END IF;

  -- 2. Alteración de meta_daily_insights
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'meta_daily_insights') THEN
    ALTER TABLE public.meta_daily_insights
      ADD COLUMN IF NOT EXISTS actions JSONB,
      ADD COLUMN IF NOT EXISTS action_values JSONB,
      ADD COLUMN IF NOT EXISTS lead_actions INTEGER GENERATED ALWAYS AS (
        COALESCE((actions->'lead')::int, 0) +
        COALESCE((actions->'onsite_conversion.lead_grouped')::int, 0) +
        COALESCE((actions->'contact_total')::int, 0)
      ) STORED;
  ELSE
    RAISE NOTICE 'La tabla meta_daily_insights no existe, saltando adición de columnas de acciones.';
  END IF;
END $$;
