# Auditoría de Secuencia y Estado Automático Doctoralia (2026-06-10)

## Resumen
Se han implementado dos vistas nuevas en Supabase para clasificar automáticamente el estado de los leads/pacientes basándose exclusivamente en la secuencia de citas de Doctoralia, eliminando la dependencia de estados manuales o financieros para la definición de agendado, convertido o recurrente.

## Reglas de Negocio Aplicadas
- **Fuente de Verdad**: `public.doctoralia_appointments_ingestion`.
- **Exclusión**: Citas con `is_cancelled = true` no cuentan para la secuencia de avance de estado.
- **Identidad**: `phone_normalized` > `normalize_person_name(patient_name)` > `doctoralia_id`.
- **Estados Automáticos**:
  - **agendado**: Primera cita válida detectada para el paciente.
  - **convertido**: Segunda cita válida, siempre que sea en la agenda de Juan José Ramos (JJRT).
  - **pendiente_revisión**: Segunda cita válida pero fuera de la agenda JJRT.
  - **recurrente**: Tercera cita válida o posterior.
  - **cancelado**: Cita anulada (no afecta el estado histórico del paciente si ya tiene estados superiores).

## Objetos Creados
1. **Vista `public.v_doctoralia_appointment_sequence`**:
   - Calcula el número de secuencia (`valid_appointment_sequence_number`) por paciente.
   - Determina el `auto_status` para cada fila de cita.
   - Proporciona métricas agregadas por paciente (primera/última cita, totales).

2. **Vista `public.v_doctoralia_patient_auto_status`**:
   - Agrupa por paciente (`identity_key`).
   - Determina el estado final del paciente basándose en el rango más alto alcanzado (`recurrente` > `convertido` > `agendado`).

## Validación de Resultados Preliminares
Basado en la ejecución de las reglas sobre el dataset actual:
- **Total Citas Doctoralia**: 651
- **Citas Canceladas**: 90
- **Citas Válidas**: 561
- **Pacientes con Citas Válidas**: ~288
- **Distribución de Estado**:
  - `agendado`: ~276 pacientes
  - `convertido`: ~10 pacientes
  - `recurrente`: ~2 pacientes

## Notas Técnicas
- Se añadió la función `public.normalize_person_name` como alias de `public.normalize_name` para mantener compatibilidad con el SQL de la migración.
- Ambas vistas utilizan `security_invoker = true` para respetar el contexto de ejecución.
- Estas vistas sirven de base para las actualizaciones de los KPIs de Figma.
