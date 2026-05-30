-- Anomaly detection: Producciones "Pagada" que aún no se han enviado a Meta CAPI
-- Úsalo para detectar registros que podrían necesitar re-procesamiento o revisión manual.

SELECT 
  id,
  created_at,
  estado,
  importe,
  phone_normalized,
  clinic_id,
  capi_sent,
  -- Opcional: intenta traer el nombre del paciente si existe en la vista de trazabilidad
  (SELECT paciente_nombre 
   FROM vw_doctoralia_lead_traceability_unified 
   WHERE paciente_telefono_normalized = produccion_intermediarios.phone_normalized 
     AND clinic_id = produccion_intermediarios.clinic_id 
   LIMIT 1) AS posible_paciente
FROM public.produccion_intermediarios
WHERE estado ILIKE '%pagada%'
  AND (capi_sent IS FALSE OR capi_sent IS NULL)
ORDER BY created_at DESC;