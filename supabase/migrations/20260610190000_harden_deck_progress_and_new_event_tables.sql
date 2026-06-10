-- =============================================================================
-- Migración: Harden deck_progress and close new event tables
-- Fecha: 2026-06-10
-- Objetivo:
--   1. Eliminar policies anónimas peligrosas de public.deck_progress.
--   2. Crear policies autenticadas por ownership para public.deck_progress.
--   3. Asegurar que lead_events y patient_classification tengan RLS pero sin policies (cerradas).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Harden `public.deck_progress`
-- -----------------------------------------------------------------------------

-- Eliminar policies anónimas peligrosas reportadas por Supabase Advisors
DROP POLICY IF EXISTS anon_insert_deck_progress ON public.deck_progress;
DROP POLICY IF EXISTS anon_update_deck_progress ON public.deck_progress;
DROP POLICY IF EXISTS anon_delete_deck_progress ON public.deck_progress;

-- Asegurar que RLS está habilitado
ALTER TABLE public.deck_progress ENABLE ROW LEVEL SECURITY;

-- Crear policies autenticadas por ownership
-- deck_progress tiene user_id TEXT, por lo que comparamos con auth.uid()::text
CREATE POLICY deck_progress_select_own ON public.deck_progress
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid()::text);

CREATE POLICY deck_progress_insert_own ON public.deck_progress
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY deck_progress_update_own ON public.deck_progress
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY deck_progress_delete_own ON public.deck_progress
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid()::text);

-- Nota: anon_select_deck_progress se mantiene por ahora si existe para no romper el frontend
-- en flujos de lectura que no requieran auth, según instrucciones.


-- -----------------------------------------------------------------------------
-- 2. New Event Tables Security (lead_events y patient_classification)
-- -----------------------------------------------------------------------------

-- Estas tablas deben permanecer cerradas al acceso directo desde el frontend (anon/authenticated).
-- Se habilitará RLS sin policies para asegurar que solo el service role o funciones SECURITY DEFINER
-- puedan operar sobre ellas.

DO $$
BEGIN
    -- Habilitar RLS en lead_events si existe
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lead_events') THEN
        ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
        
        -- Eliminar cualquier policy accidental para anon/authenticated si existieran
        -- (según advisor actualmente no tienen policies, pero es una medida preventiva)
    END IF;

    -- Habilitar RLS en patient_classification si existe
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patient_classification') THEN
        ALTER TABLE public.patient_classification ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

COMMENT ON TABLE public.lead_events IS 'Registro de eventos de leads. RLS habilitado sin policies: Acceso restringido a service_role o funciones internas.';
COMMENT ON TABLE public.patient_classification IS 'Clasificación operativa de pacientes. RLS habilitado sin policies: Acceso restringido a service_role o funciones internas.';

COMMIT;
