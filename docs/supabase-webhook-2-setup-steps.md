# Pasos Exactos para Configurar Webhook #2 en Supabase (Google Sheets)

Este documento sigue **exactamente** las indicaciones que te dieron:

## 1. En Google Apps Script (ya debes haberlo hecho)

- Abre tu proyecto de Apps Script
- Busca esta línea y pon la clave real:

```js
const EXPECTED_SECRET = "Doctoralia_Secret_2026_!!";
```

- Implementa como Aplicación Web → "Cualquiera"
- Copia la URL (termina en `/exec`)

## 2. Configurar el Webhook en Supabase Dashboard (paso a paso)

**Estado: ✅ CREADO** (confirmado por el usuario el 27 de mayo de 2026)

### Configuración aplicada:

- **Name**: `Sync_To_Google_Sheets`
- **Table**: `produccion_intermediarios`
- **Events**: `INSERT` + `UPDATE`
- **Webhook URL**: `https://script.google.com/macros/s/AKfycbw9vSRSfyqEbYB0qptAIpj0ElGB-q44JttJrob21qIpVHclEu-0-jjrjxenen0dtHgr/exec`
- **Header**: `X-Webhook-Secret = Doctoralia_Secret_2026_!!`
- **Method**: `POST`

### HTTP Headers (esto es lo que pediste específicamente):

Haz clic en **Add header**:

- **Name**: `X-Webhook-Secret`
- **Value**: `Doctoralia_Secret_2026_!!`

(Guarda esta misma clave también en:
- Tu archivo local `.env.webhooks`
- GitHub Secrets como `SHEETS_WEBHOOK_SECRET` si usas Actions)

### Condiciones (Opcional):

Puedes dejarlo vacío. El script ya maneja la lógica internamente.

## 3. Guardar el secret local y en GitHub

### Local (.env)

Crea o edita el archivo `.env.webhooks` con:

```env
SUPABASE_ACCESS_TOKEN=sbp_tu_token_real
SUPABASE_PROJECT_REF=ssvvuuysgxyqvmovrlvk
SHEETS_WEBHOOK_URL=https://script.google.com/.../exec
SHEETS_WEBHOOK_SECRET=Doctoralia_Secret_2026_!!
```

### En GitHub (para que el script de setup funcione en CI)

Ve a tu repo → Settings → Secrets and variables → Actions → New repository secret:

- `SHEETS_WEBHOOK_SECRET` = `Doctoralia_Secret_2026_!!`
- `SHEETS_WEBHOOK_URL` = (la URL de tu Apps Script)
- `SUPABASE_ACCESS_TOKEN` = tu token
- `SUPABASE_PROJECT_REF` = `ssvvuuysgxyqvmovrlvk`

## 4. Estado Actual

**Webhook #2 (Sync_To_Google_Sheets) → ✅ CREADO**

Fecha de creación: 27 de mayo de 2026

---

## 5. Verificación y Pruebas (Próximos Pasos)

Ahora que el webhook está creado, realiza estas validaciones:

### 5.1 Prueba manual desde Supabase Dashboard

1. Ve a **Database → Webhooks**
2. Busca el webhook `Sync_To_Google_Sheets`
3. Haz clic en los tres puntos → **Send test**
4. Elige un evento (`INSERT` o `UPDATE`) y envía un payload de prueba.

### 5.2 Ver logs en Google Apps Script

1. Abre el proyecto de Apps Script.
2. Ve al menú **Ejecuciones** (icono de reloj a la izquierda).
3. Deberías ver una ejecución reciente con el payload que enviaste desde Supabase.

### 5.3 Payload de prueba recomendado

Puedes usar este JSON mínimo para probar:

```json
{
  "type": "UPDATE",
  "table": "produccion_intermediarios",
  "record": {
    "id": "test-uuid-123",
    "estado": "Pagada",
    "fecha": "2026-05-27",
    "hora": "10:30",
    "asunto": "Test Webhook - Paciente Ejemplo",
    "importe": 450,
    "agenda": "Dra. Prueba",
    "sala_box": "Box Test"
  },
  "old_record": {
    "estado": "Confirmada"
  }
}
```

---

**Siguiente acción recomendada:**

Dime qué quieres hacer ahora:

1. Hacer una prueba real del webhook (te ayudo a generar un payload limpio).
2. Crear el **Webhook #1** (el de CAPI para eventos Purchase).
3. Revisar/actualizar el Google Apps Script para manejar mejor los datos que llegan.
4. Actualizar el diagrama de arquitectura con el estado actual de los dos webhooks.

¿Qué prefieres?

```bash
# Opción recomendada (carga las variables del archivo pero no usa dotenv dentro del script)
source .env.webhooks && node scripts/setup-supabase-webhooks.js
```

O definiendo las variables directamente:

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
export SUPABASE_PROJECT_REF="ssvvuuysgxyqvmovrlvk"
export SHEETS_WEBHOOK_URL="https://script.google.com/.../exec"
export SHEETS_WEBHOOK_SECRET="Doctoralia_Secret_2026_!!"

node scripts/setup-supabase-webhooks.js
```

---

Una vez hecho esto, cada cambio en `produccion_intermediarios` (incluyendo cuando una cita pasa a "pagada") actualizará automáticamente tu hoja de Google Sheets en tiempo real.

¿Quieres que prepare también el comando para crear el Webhook #1 (el de CAPI) con el mismo enfoque?