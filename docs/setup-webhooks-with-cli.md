# Setting Up Supabase Database Webhooks via CLI (Native HTTPS - Sin Dependencias)

Esta guía usa la **versión nativa** del script (`https` module de Node.js) para crear los webhooks sin necesidad de instalar `node-fetch` ni otras dependencias.

## Prerrequisitos

1. Supabase CLI instalado y autenticado
2. GitHub CLI (`gh`) autenticado (`gh auth login`)
3. Tu Personal Access Token de Supabase (con permisos de admin)

## Paso 1: Aplicar Migración y Desplegar Función

```bash
supabase db push
supabase functions deploy api --no-verify-jwt
```

## Paso 2: Guardar Secretos con CLI (Local + GitHub + Supabase)

### 2.1 Localmente (`.env.webhooks`)

```bash
cp .env.webhooks.example .env.webhooks
# Edita .env.webhooks y pon tus valores reales
```

Contenido recomendado:
```env
SUPABASE_ACCESS_TOKEN=sbp_tu_token_real
SUPABASE_PROJECT_REF=ssvvuuysgxyqvmovrlvk
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/TU_URL_REAL/exec
SHEETS_WEBHOOK_SECRET=Doctoralia_Secret_2026_!!
```

### 2.2 En GitHub (usando gh CLI)

```bash
# Secret principal (ya configurado)
echo "Doctoralia_Secret_2026_!!" | gh secret set SHEETS_WEBHOOK_SECRET --repo Arisofia/Nuvanx-System

# Los dos que faltan (reemplaza con tus valores reales)
gh secret set SHEETS_WEBHOOK_URL --repo Arisofia/Nuvanx-System   # Pega tu URL de Google Apps Script
gh secret set SUPABASE_ACCESS_TOKEN --repo Arisofia/Nuvanx-System   # Pega tu sbp_ token
```

### 2.3 En Supabase (usando Supabase CLI)

```bash
# Opción recomendada
supabase secrets set SHEETS_WEBHOOK_SECRET="Doctoralia_Secret_2026_!!" --project-ref ssvvuuysgxyqvmovrlvk

# También puedes guardar los otros dos
supabase secrets set SHEETS_WEBHOOK_URL="https://script.google.com/..." --project-ref ssvvuuysgxyqvmovrlvk
supabase secrets set SUPABASE_ACCESS_TOKEN="sbp_..." --project-ref ssvvuuysgxyqvmovrlvk
```

## Paso 3: Ejecutar el Script de Creación de Webhooks

Se recomienda usar **exports manuales** o GitHub Secrets (sin depender de archivos .env en tiempo de ejecución):

```bash
# Opción recomendada: exports directos
export SUPABASE_ACCESS_TOKEN="sbp_tu_token"
export SUPABASE_PROJECT_REF="ssvvuuysgxyqvmovrlvk"
export SHEETS_WEBHOOK_URL="https://script.google.com/..."
export SHEETS_WEBHOOK_SECRET="Doctoralia_Secret_2026_!!"

node scripts/setup-supabase-webhooks.js
```

Para GitHub Actions, simplemente define los secrets en el repositorio. El script los leerá automáticamente desde `process.env`.

El script (versión nativa sin dependencias) creará o actualizará:
- `Sync_To_Google_Sheets` (Webhook #2 hacia Google Apps Script)
- (Opcional) Webhook #1 para CAPI si se extiende

## Importante: Limitación del Webhook #2 (Google Sheets)

**El script `setup-supabase-webhooks.js` NO puede crear el Webhook #2** (`Sync_To_Google_Sheets` hacia Google Apps Script).

La Management API de Supabase devuelve **404** en `/v1/projects/{ref}/database/webhooks` para webhooks de tipo `http_request`.

**Solución oficial (y la que funciona):** Créalo manualmente una sola vez en el Dashboard.

Pasos:
1. https://supabase.com/dashboard/project/ssvvuuysgxyqvmovrlvk/database/webhooks
2. "Create a new hook"
3. Name: `Sync_To_Google_Sheets`
4. Table: `produccion_intermediarios`
5. Events: `INSERT` + `UPDATE`
6. Webhook URL: la URL de tu Apps Script
7. Add header:
   - `X-Webhook-Secret` = `Doctoralia_Secret_2026_!!`
8. Create webhook.

El script ahora detecta el 404 y te muestra estos pasos automáticamente.

## Webhook #1 (CAPI)

El webhook interno hacia la Edge Function (`/functions/v1/api/webhooks/supabase`) se configura normalmente desde el Dashboard o vía Edge Functions.

## Notas

- El script `scripts/setup-supabase-webhooks.js` usa solo el módulo `https` nativo de Node.js.
- El secreto `SHEETS_WEBHOOK_SECRET` debe coincidir exactamente entre Supabase y tu Google Apps Script.

---

**Última actualización:** Versión nativa sin dependencias externas (https module).