-- Backfill: asignar clinic_id a usuarios que no tienen uno pero pertenecen a una clínica existente.
-- Es idempotente (solo actualiza si clinic_id IS NULL).

-- Primero: asignar la primera clínica disponible a usuarios sin clinic_id.
-- Si hay una sola clínica en el sistema, esto es correcto.
-- Si hay múltiples clínicas, ajusta la lógica según la regla de negocio.
DO $$
DECLARE
  default_clinic_id uuid;
BEGIN
  SELECT id INTO default_clinic_id FROM public.clinics ORDER BY created_at ASC LIMIT 1;
  
  IF default_clinic_id IS NOT NULL THEN
    UPDATE public.users
    SET clinic_id = default_clinic_id
    WHERE clinic_id IS NULL;
    
    RAISE NOTICE 'Backfilled clinic_id=% for % users',
      default_clinic_id,
      (SELECT count(*) FROM public.users WHERE clinic_id = default_clinic_id);
  ELSE
    RAISE NOTICE 'No clinics found. Skipping backfill.';
  END IF;
END $$;
