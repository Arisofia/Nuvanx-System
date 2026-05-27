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

Ve a tu proyecto en Supabase:

1. Ve a **Database** → **Webhooks**
2. Haz clic en **Create a new hook** (o "Add webhook")

### Configuración:

- **Name**: `Sync_To_Google_Sheets`
- **Table**: `produccion_intermediarios`
- **Events**: Selecciona **INSERT** y **UPDATE**
- **Webhook URL**: Pega aquí la URL completa de tu Google Apps Script (la que terminaba en `/exec`)
- **Method HTTP**: `POST`

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

## 4. Ejecutar la creación vía CLI (recomendado)

Después de tener `.env.webhooks` configurado con los valores reales:

```bash
cd /Users/MARIA/Nuvanx-System

node -r dotenv/config scripts/setup-supabase-webhooks.js --env-file=.env.webhooks
```

O con exports manuales:

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