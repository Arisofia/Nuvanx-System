-- 1. Reparar teléfonos en la tabla LEADS extrayendo del campo JSON 'notes'
UPDATE public.leads
SET phone = COALESCE(
    notes->>'telefono',
    notes->>'phone_number',
    notes->>'phone',
    phone
)
WHERE phone IS NULL AND notes IS NOT NULL;

-- 2. Limpiar teléfonos en LEADS (solo números, últimos 9)
UPDATE public.leads
SET phone = RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 9)
WHERE phone IS NOT NULL AND length(REGEXP_REPLACE(phone, '\D', '', 'g')) >= 9;

-- 3. Reparar teléfonos en DOCTORALIA_SETTLEMENTS extrayendo del campo 'asunto'
-- Formato típico: "... [619056677] ..."
UPDATE public.doctoralia_settlements
SET paciente_telefono = (REGEXP_MATCH(asunto, '\[(\d{9})\]'))[1]
WHERE (paciente_telefono IS NULL OR paciente_telefono = '') 
  AND asunto ~ '\[\d{9}\]';

-- Si no hay corchetes, intentar cualquier secuencia de 9 dígitos en el asunto
UPDATE public.doctoralia_settlements
SET paciente_telefono = (REGEXP_MATCH(asunto, '(\d{9})'))[1]
WHERE (paciente_telefono IS NULL OR paciente_telefono = '') 
  AND asunto ~ '\d{9}'
  AND NOT asunto ~ '\[\d{9}\]';

-- 4. Normalizar paciente_telefono en SETTLEMENTS
UPDATE public.doctoralia_settlements
SET paciente_telefono = RIGHT(REGEXP_REPLACE(paciente_telefono, '\D', '', 'g'), 9)
WHERE paciente_telefono IS NOT NULL AND length(REGEXP_REPLACE(paciente_telefono, '\D', '', 'g')) >= 9;

-- 5. Ejecutar el matching masivo usando la lógica de 9 dígitos
UPDATE public.leads l
SET 
  external_id = s.paciente_id,
  status = 'convertido',
  updated_at = NOW()
FROM public.doctoralia_settlements s
WHERE l.external_id IS NULL
  AND l.phone IS NOT NULL
  AND s.paciente_telefono IS NOT NULL
  AND l.phone = s.paciente_telefono;

-- 6. Forzar refresco de la vista de trazabilidad
NOTIFY pgrst, 'reload schema';
