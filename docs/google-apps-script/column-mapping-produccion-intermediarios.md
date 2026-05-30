# Mapeo de Columnas - Webhook Produccion Intermediarios

Este documento alinea el Google Apps Script con la definición real de la tabla `produccion_intermediarios` en Supabase.

## Columnas Reales de la Tabla (migración 20260530205600)

```sql
CREATE TABLE public.produccion_intermediarios (
  id UUID PRIMARY KEY,
  clinic_id UUID,
  estado TEXT,
  fecha DATE,
  hora TEXT,
  fecha_creacion DATE,
  hora_creacion TIME,
  asunto TEXT,           -- CLAVE PRINCIPAL para deduplicación
  agenda TEXT,
  sala_box TEXT,
  confirmada BOOLEAN,
  procedencia TEXT,
  importe NUMERIC,
  fecha_para_normalizar DATE,
  doc_patient_id TEXT,   -- ID en Doctoralia
  paciente_nombre TEXT,  -- Nombre en Doctoralia
  telefono_original TEXT,
  procedimiento_nombre TEXT, -- Tratamiento
  tipo_cliente TEXT,
  email_hubspot TEXT,
  ejecutivo_asignado TEXT,
  ingreso_lead TEXT,
  campana TEXT,
  dia INTEGER,
  mes INTEGER,
  ano INTEGER,
  phone_normalized TEXT, -- derivado de 'asunto'
  ...
);
```

## Mapeo Actual en el Script

| Posición en Hoja | Campo en record (Supabase) | Columna real en Supabase | Notas |
|------------------|---------------------------|---------------------------|-------|
| A                | estado                    | estado                    | - |
| B                | fecha                     | fecha                     | - |
| C                | hora                      | hora                      | - |
| D                | fecha_creacion            | fecha_creacion            | - |
| E                | hora_creacion             | hora_creacion             | - |
| F                | asunto                    | asunto                    | **Clave única** para buscar/actualizar |
| G                | agenda                    | agenda                    | - |
| H                | sala_box                  | sala_box                  | - |
| I                | confirmada                | confirmada                | BOOLEAN |
| J                | procedencia               | procedencia               | - |
| K                | importe                   | importe                   | - |
| L                | fecha_para_normalizar     | fecha_para_normalizar     | - |
| M                | doc_patient_id            | doc_patient_id            | ID (Doctoralia) |
| N                | paciente_nombre           | paciente_nombre           | Nombre (Doctoralia) |
| O                | telefono_original         | telefono_original         | Teléfono |
| P                | procedimiento_nombre      | procedimiento_nombre      | Tratamiento |
| Q                | tipo_cliente              | tipo_cliente              | - |
| R                | email_hubspot             | email_hubspot             | - |
| S                | ejecutivo_asignado        | ejecutivo_asignado        | - |
| T                | ingreso_lead              | ingreso_lead              | - |
| U                | campana                   | campana                   | - |
| V                | (fórmula)                 | dia                       | `=DAY(B...)` |
| W                | (fórmula)                 | mes                       | `=MONTH(B...)` |
| X                | (fórmula)                 | ano                       | `=YEAR(B...)` |

## Cambios Recientes (Mayo 2026)

Ya aplicados en `webhook-produccion-intermediarios.js`:
- Se amplió el mapeo a 24 columnas para coincidir con el análisis técnico.
- Se añadió soporte para `fecha_para_normalizar`.
- Se añadieron fórmulas automáticas para `Día`, `Mes` y `Año` en nuevas filas.

## Si Quieres Cambiar la Clave de Deduplicación

Si prefieres usar un ID más estable en lugar de `asunto`, avísame y ajustamos esta línea:

```js
if (String(data[i][asuntoIndex]).trim() === String(record.asunto).trim())
```

a usar `record.id` (o el campo que uses como identificador único).

## Seguridad

Recuerda poner un `EXPECTED_SECRET` real en el script y configurarlo también en el Webhook de Supabase (header `X-Webhook-Secret`).

---

**Archivo del script robusto:** `docs/google-apps-script/webhook-produccion-intermediarios.js`