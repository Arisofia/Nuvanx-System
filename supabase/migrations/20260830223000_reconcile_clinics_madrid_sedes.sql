-- Migration: 20260830223000_reconcile_clinics_madrid_sedes.sql
-- Description: Reconcile canonical Madrid medical clinics and fix legacy America/Tegucigalpa timezone defect.

DO $$
BEGIN
    -- 1. Update existing primary clinic (Chamberí) with canonical Madrid timezone, country and metadata
    UPDATE public.clinics
    SET 
        name = 'Centro Clínico NUVANX Chamberí',
        slug = 'nuvanx-chamberi',
        country = 'ES',
        timezone = 'Europe/Madrid',
        settings = jsonb_build_object(
            'address', 'Calle de Fernández de la Hoz, 45, Bajo Derecha',
            'postal_code', '28010',
            'locality', 'Madrid',
            'registro_sanitario', 'CS20144',
            'phone', '+34669319836',
            'short_name', 'Chamberí'
        ),
        updated_at = now()
    WHERE id = '4207023b-eac1-4249-bf0f-d9b1e36a5d7a';

    -- 2. Insert second clinic (Salamanca–Goya) with CS20073
    INSERT INTO public.clinics (
        id,
        name,
        slug,
        plan,
        country,
        timezone,
        settings,
        is_active,
        created_at,
        updated_at
    )
    VALUES (
        'b107023b-eac1-4249-bf0f-d9b1e36a5d7b',
        'Centro Clínico NUVANX Salamanca–Goya',
        'nuvanx-goya',
        'starter',
        'ES',
        'Europe/Madrid',
        jsonb_build_object(
            'address', 'Calle de Fernán González, 26',
            'postal_code', '28009',
            'locality', 'Madrid',
            'registro_sanitario', 'CS20073',
            'phone', '+34647505107',
            'short_name', 'Salamanca–Goya'
        ),
        true,
        now(),
        now()
    )
    ON CONFLICT (slug) DO UPDATE
    SET 
        name = EXCLUDED.name,
        country = EXCLUDED.country,
        timezone = EXCLUDED.timezone,
        settings = EXCLUDED.settings,
        is_active = EXCLUDED.is_active,
        updated_at = now();
END $$;
