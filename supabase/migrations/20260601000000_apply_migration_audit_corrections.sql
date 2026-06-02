-- =============================================================================
-- Aplicación de correcciones derivadas de revisiones profundas de migraciones
-- (Lotes 6, 7, 8 y 9 - Mayo 2026)
--
-- Fecha: 2026-06-01
--
-- Correcciones aplicadas (basadas en recomendaciones de revisión):
--   1. Añadir triggers de updated_at automático a las 4 tablas de insights de Meta
--      (meta_ig_account_daily, meta_ig_media_performance, meta_organic_daily,
--       meta_post_performance). Las columnas ya existían con DEFAULT NOW(),
--      pero no se actualizaban en cambios posteriores.
--   2. Aclarar comentarios confusos sobre métricas deprecadas en v22 (Meta Graph API).
--   3. Añadir índices de rendimiento en columnas clave de atribución Meta añadidas
--      a la tabla leads (is_organic, meta_ad_id, meta_form_id, hashes).
--   4. Hardening del helper handle_updated_at con search_path seguro.
--
-- Nota: No se modifican migraciones históricas (son inmutables). Se aplican
-- correcciones forward-only mediante esta migración de endurecimiento.
-- =============================================================================

BEGIN;

-- ============================================================================
-- 1. Hardening del helper de updated_at (reutilizable y con search_path seguro)
-- ============================================================================
-- La versión original (20260523100000) era funcional pero no tenía
-- search_path endurecido. La redefinimos aquí siguiendo el patrón
-- de consolidación RLS.

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_updated_at() IS
  'Trigger function para mantener updated_at actualizado automáticamente. '
  'Hardened 2026-06-01 (search_path + SECURITY DEFINER) tras revisiones de migraciones.';

-- ============================================================================
-- 2. Triggers de updated_at en tablas de Instagram Insights
-- ============================================================================
-- Se usan verificaciones defensivas (to_regclass) siguiendo el patrón
-- del resto del proyecto.

DO $$
BEGIN
  IF to_regclass('public.meta_ig_account_daily') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_meta_ig_account_daily_updated_at ON public.meta_ig_account_daily;
    CREATE TRIGGER trg_meta_ig_account_daily_updated_at
      BEFORE UPDATE ON public.meta_ig_account_daily
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF to_regclass('public.meta_ig_media_performance') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_meta_ig_media_performance_updated_at ON public.meta_ig_media_performance;
    CREATE TRIGGER trg_meta_ig_media_performance_updated_at
      BEFORE UPDATE ON public.meta_ig_media_performance
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- ============================================================================
-- 3. Triggers de updated_at en tablas de Organic Insights
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.meta_organic_daily') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_meta_organic_daily_updated_at ON public.meta_organic_daily;
    CREATE TRIGGER trg_meta_organic_daily_updated_at
      BEFORE UPDATE ON public.meta_organic_daily
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF to_regclass('public.meta_post_performance') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_meta_post_performance_updated_at ON public.meta_post_performance;
    CREATE TRIGGER trg_meta_post_performance_updated_at
      BEFORE UPDATE ON public.meta_post_performance
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- ============================================================================
-- 4. Aclaración de comentarios sobre métricas deprecadas (Meta Graph API v22)
-- ============================================================================
-- Los comentarios originales generaban confusión sobre qué métricas siguen
-- siendo útiles. Se reescriben para ser más precisos y accionables.

COMMENT ON TABLE public.meta_organic_daily IS
  'Daily Page Insights (mezcla orgánico + pagado a nivel de página). '
  'NOTA: A partir de Graph API v22, Meta dejó de exponer métricas puramente orgánicas '
  'a nivel de página (impressions/video_views orgánicos puros). '
  'Usar meta_post_performance para atribución de contenido orgánico real por post. '
  'Esta tabla sigue siendo útil para tendencias generales de la página. '
  'Corregido 2026-06-01 tras revisión profunda de migraciones.';

COMMENT ON TABLE public.meta_ig_account_daily IS
  'Daily account-level Instagram Business Account insights. '
  'Métricas disponibles vía time_series y total_value según Graph API vigente. '
  'Corregido 2026-06-01: se eliminó ambigüedad sobre métricas deprecadas.';

COMMENT ON TABLE public.meta_ig_media_performance IS
  'Per-media lifetime metrics para IG Business Account. '
  'Usar para atribución orgánica por pieza de contenido (filtrar por caption). '
  'Corregido 2026-06-01 tras revisión de Lote 8.';

-- ============================================================================
-- 5. Índices de rendimiento en columnas Meta de la tabla leads
-- ============================================================================
-- Recomendación directa de la revisión del Lote 8:
-- La tabla leads se volvió muy ancha; es crítico indexar las columnas
-- más consultadas para trazabilidad y atribución.

DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    -- 5.1 is_organic (muy usado para separar tráfico pagado vs orgánico)
    CREATE INDEX IF NOT EXISTS idx_leads_is_organic
      ON public.leads (clinic_id, is_organic, created_at DESC)
      WHERE is_organic IS NOT NULL;

    -- 5.2 meta_ad_id (atribución a nivel de anuncio)
    CREATE INDEX IF NOT EXISTS idx_leads_meta_ad_id
      ON public.leads (meta_ad_id)
      WHERE meta_ad_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_clinic_meta_ad_id
      ON public.leads (clinic_id, meta_ad_id, created_at DESC)
      WHERE meta_ad_id IS NOT NULL;

    -- 5.3 meta_form_id (útil para segmentación por formulario/intención)
    CREATE INDEX IF NOT EXISTS idx_leads_meta_form_id
      ON public.leads (meta_form_id)
      WHERE meta_form_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_clinic_meta_form_id
      ON public.leads (clinic_id, meta_form_id, created_at DESC)
      WHERE meta_form_id IS NOT NULL;

    -- 5.4 Hashes de privacidad (para matching futuro privacy-friendly)
    CREATE INDEX IF NOT EXISTS idx_leads_telefono_hash
      ON public.leads (telefono_hash)
      WHERE telefono_hash IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_email_hash
      ON public.leads (email_hash)
      WHERE email_hash IS NOT NULL;

    -- 5.5 meta_ad_name (para reporting legible cuando no se tiene el ID)
    CREATE INDEX IF NOT EXISTS idx_leads_meta_ad_name
      ON public.leads (clinic_id, meta_ad_name)
      WHERE meta_ad_name IS NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 6. Índices adicionales recomendados en tablas de insights (crecimiento futuro)
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.meta_ig_account_daily') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_meta_ig_account_daily_ig_id
      ON public.meta_ig_account_daily (ig_id, date DESC);
  END IF;

  IF to_regclass('public.meta_ig_media_performance') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_meta_ig_media_performance_ig_id
      ON public.meta_ig_media_performance (ig_id, timestamp DESC);
  END IF;
END $$;

-- (Documentación de correcciones omitida - verbosa RAISE NOTICE removida en cleanup)

COMMIT;