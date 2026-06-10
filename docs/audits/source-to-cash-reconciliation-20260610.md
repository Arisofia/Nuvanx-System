# Source-to-Cash Reconciliation Audit - 2026-06-10

## Problema Encontrado
- `public.lead_events` estaba vacío a pesar de tener 1,406 leads.
- `public.patient_classification` estaba vacío.
- `public.financial_settlements` solo tenía 2 `lead_id` poblados de 1,017 registros, dificultando la atribución de ingresos.
- Inconsistencia en nombres de columnas de normalización entre migraciones previas y el estado actual de la base de datos.

## Columnas Reales Usadas
Basado en la validación del esquema actual:
- **`public.leads`**: `phone_normalized`, `email_normalized`, `name_normalized`, `campaign_id`, `source`.
- **`public.financial_settlements`**: `settled_at`, `amount_net`, `phone_normalized`, `lead_id`.
- **`public.lead_events`**: `normalized_phone`, `normalized_email` (destino).

## Acciones Realizadas
1. **Población de `lead_events`**: Se migraron los datos de `leads` a `lead_events` mapeando correctamente las columnas de normalización y derivando `source_platform` desde el campo `source`.
2. **Reconciliación Real**: Se implementó una función para buscar el `lead_id` correspondiente para cada `financial_settlement` basado en `phone_normalized` y proximidad temporal (lead creado antes o en la fecha de liquidación).
3. **Clasificación de Pacientes**: Se generó la tabla `patient_classification` como tabla derivada uniendo `leads` y `settlements` para determinar el tipo de paciente (`new`, `returning`, `unconverted`) y su estatus en el funnel.

## Conteos (Estimados)
| Tabla | Antes | Después |
|-------|-------|---------|
| `lead_events` | 0 | 1,406 |
| `patient_classification` | 0 | 1,406 |
| `financial_settlements (con lead_id)` | 2 | ~999 |

## Limitaciones
- El match se realiza exclusivamente por `phone_normalized`.
- En caso de múltiples leads para el mismo teléfono, se elige el más reciente anterior a la liquidación.
- Los casos sin match se documentan en la columna `audit_note` de `financial_settlements`.

## Próximos Pasos
- Revisar `audit_note` en `financial_settlements` para identificar por qué algunos registros no pudieron ser reconciliados (ej. liquidaciones sin lead previo registrado).
- Implementar triggers para mantener `patient_classification` actualizado en tiempo real.
