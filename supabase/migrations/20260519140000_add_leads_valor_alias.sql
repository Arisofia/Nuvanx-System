-- Asegurar que la columna valor existe para compatibilidad con lógica de CAPI/Notificaciones
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS valor NUMERIC(10, 2) DEFAULT 0;

COMMENT ON COLUMN public.leads.valor IS
  'Valor monetario del lead para priorización y CAPI (en EUR)';

-- Sincronizar valor inicial con revenue si ya existen datos
UPDATE public.leads
SET valor = revenue
WHERE valor = 0
  AND revenue IS NOT NULL
  AND revenue > 0;