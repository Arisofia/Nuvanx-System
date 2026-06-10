# Capa de matching auditado: Doctoralia ↔ Leads
**Fecha**: 2026-06-10
**Contexto**: Quinto bloque de ejecución para consolidación de estados automáticos.

## Objetivo
Establecer una capa de auditoría que permita vincular las citas de Doctoralia con los Leads de Meta/CRM sin sobrescribir los datos originales de `public.leads` hasta validar la confianza del match.

## Vistas creadas

### 1. `public.v_doctoralia_lead_identity_candidates`
Muestra todas las combinaciones posibles de match entre citas de Doctoralia y leads activos.

**Reglas de Matching**:
- **phone_exact** (Confianza: 1.00): Coincidencia exacta en `phone_normalized`.
- **name_and_date_window** (Confianza: 0.85): Coincidencia en nombre normalizado y el lead fue creado antes o el mismo día de la cita.
- **name_exact_normalized** (Confianza: 0.80): Coincidencia en nombre normalizado sin restricción de fecha.

### 2. `public.v_doctoralia_lead_best_match`
Filtra los candidatos para devolver solo el "Mejor Match" por cada cita de Doctoralia.
- **Prioridad**: Confianza del match (descendente) y cercanía temporal (ascendente).

### 3. `public.v_lead_status_auto_consolidated`
Vista consolidada que une los leads con su estado operativo derivado de Doctoralia.

**Lógica de precedencia de estado**:
- Si hay match: `recurrente` > `convertido` > `agendado`.
- Si no hay match: Se mantiene el estado original del CRM (`leads.stage`).

## Hallazgos de arquitectura
- Se detectó que solo 143 leads activos tienen `phone_normalized`, mientras que 702 tienen `name_normalized`.
- La identidad construible en Doctoralia (308 citas válidas) permite un cruce por nombre que aumenta significativamente la trazabilidad comparado con el cruce solo por teléfono.

## Próximos pasos
1. Auditar la vista `v_lead_status_auto_consolidated` para verificar falsos positivos.
2. Una vez validado, proceder con la actualización masiva de `public.leads.stage` usando la lógica de esta capa de matching.
3. Actualizar KPIs de Figma para consumir esta vista consolidada en lugar de los datos crudos del CRM.
