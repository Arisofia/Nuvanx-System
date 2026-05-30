# Mapeo de Columnas - Webhook Produccion Intermediarios

Este documento alinea el Google Apps Script con la definición real de la tabla `produccion_intermediarios` en Supabase.

## Columnas Reales de la Tabla (migración 20260513200000)

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
| L                | (usamos fecha)            | -                         | No existe `fecha_para_normalizar` |

## Cambios Recomendados en el Script de Google

Ya aplicados en `webhook-produccion-intermediarios.js`:
- Se corrigió el mapeo para usar columnas reales.
- Se eliminó la referencia a `fecha_para_normalizar` (no existe).
- Se mejoró el comentario sobre `asunto` como clave.

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