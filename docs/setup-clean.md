# Setup limpio desde cero

Este documento describe los pasos necesarios para dejar el repositorio listo para arrancar desde una base de datos vacía o casi vacía, sin insertar datos de ejemplo.

## Objetivos

- Código y migraciones sincronizados.
- Entornos coherentes: local, Supabase, Vercel, GitHub Actions.
- Sin datos falsos ni mocks en el repositorio.
- Capaz de arrancar desde una BD vacía y funcionar con datos reales cuando lleguen.

## Resumen de estado actual

- El repo está en estado limpio (`git status --short` no muestra cambios pendientes).
- No hay archivos de workflow con errores de sintaxis.
- La app frontend usa `invokeApi('/...')` y no endpoints antiguos directos fuera de `/api`.
- El archivo `.env.example` ya documenta los valores principales para desarrollo local.

## 1. Estado del repo

- Mantener `main` sincronizado con `origin/main`.
- No dejar cambios pendientes en:
  - `supabase/functions/api/index.ts`
  - `scripts/meta-backfill.js`
  - `supabase/migrations/*`

## 2. Migraciones y Supabase

### Revisión de migraciones

1. Ejecutar:
   ```bash
   supabase db status
   ```
2. Si hay migraciones pendientes:
   ```bash
   supabase db push
   ```
3. Si aparecen ghost migrations:
   - Verificar que el archivo correspondiente existe en `supabase/migrations/`.
   - Si el archivo no existe, no eliminar datos en producción. En su lugar, verificar con el equipo y volver a generar el migration file.
   - Si el ghost está causado por una migración ya aplicada, usar `supabase migration repair` para marcarla correctamente.

### Objetivos de esquema

La DB debe contener:

- `public.leads` con todas las columnas actualizadas.
- `public.meta_daily_insights` con la columna `messaging_conversations` y esquema actual.
- `public.doctoralia_patients` consistente.
- `public.financial_settlements` consistente.
- Vistas `vw_*` que funcionen con los datos de producción.

## 3. Integrations / Credentials

### 3.1 Meta

- `credentials`:
  - `service = 'meta'`
  - `encrypted_key` debe contener el `META_ACCESS_TOKEN` válido, cifrado con `ENCRYPTION_KEY`.

- `integrations`:
  - `service = 'meta'`
  - `metadata.adAccountIds` debe incluir `act_9523446201036125`.
  - `metadata.adAccountId` debe ser `act_9523446201036125`.
  - `metadata.pageId` debe ser la página correcta de Nuvanx.
  - `metadata.igBusinessAccountId` debe existir si aplica.

#### SQL de normalización recomendado

```sql
UPDATE integrations
SET metadata = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{adAccountIds}',
            '["act_9523446201036125"]'::jsonb
          ),
          '{ad_account_ids}',
          '["act_9523446201036125"]'::jsonb
        ),
        '{adAccountId}',
        '"act_9523446201036125"'::jsonb
      ),
      '{ad_account_id}',
      '"act_9523446201036125"'::jsonb
    )
WHERE service = 'meta'
  AND user_id = 'a2f2b8a1-fedb-4a74-891d-b8a2089fd49a';
```

No agregar valores no verificados ni reemplazar nada en producción sin autorización.

#### Cómo actualizar el token en `credentials`

Usar el script:

```bash
DATABASE_URL=... ENCRYPTION_KEY=... REPORT_USER_ID=... META_ACCESS_TOKEN_NEW=... node scripts/set-meta-credentials.js
```

### 3.2 WhatsApp

- `integrations` con `service = 'whatsapp'` debe contener `metadata.phoneNumberId` normalizado.
- El valor debe ser el ID numérico correcto de WhatsApp Cloud API.
- Verificar que el webhook y la lógica de `handleWhatsappWebhook` usen `phoneNumberId` para asignar `userId`.

### 3.3 Doctoralia

- `financial_settlements` debe contener datos reales de Doctoralia.
- `doctoralia_patients` debe repoblarse si es necesario, preferiblemente usando DNI/hashes, o fallback de teléfono solo si no hay otra opción.
- `run_doctoralia_name_match()` debe existir como función ejecutable en el esquema y opcionalmente programarse con PG cron si se usa.
- `reconcile_doctoralia_matches_to_leads()` debe existir y ser verificable.
- Para desbloquear CAC Doctoralia en producción, ejecutar primero `npm run ingest:doctoralia` con credenciales de Supabase/Doctoralia y después `npm run doctoralia:match:phone` si se necesita fallback telefónico.

## 4. Variables de entorno

### 4.1 Local

Usar `.env.example` como plantilla.
No incluir valores reales en el repo.

Variables mínimas locales:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `ENCRYPTION_KEY`
- `META_ACCESS_TOKEN`
- `META_APP_SECRET`
- `META_PIXEL_ID`
- `FRONTEND_URL`
- `NUVANX_SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

La app frontend usa el proxy Vercel y `invokeApi('/...')`, por lo que no depende de `VITE_API_URL`.

### 4.2 Supabase Edge

Secrets obligatorios:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `ENCRYPTION_KEY`
- `META_APP_SECRET`
- `META_PIXEL_ID`
- `META_ACCESS_TOKEN`
- `NUVANX_SUPABASE_SERVICE_ROLE_KEY` — dedicated internal API bypass token for cron/backfill/sync jobs; do not reuse `SUPABASE_SERVICE_ROLE_KEY` as an HTTP bearer token.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` — required for `/webhooks/whatsapp` verification; it is intentionally separate from `META_WEBHOOK_VERIFY_TOKEN`.

Recommended when WhatsApp or Meta webhook ingestion is enabled:

- `META_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

Instrucciones:

```bash
supabase secrets set META_ACCESS_TOKEN="..."
supabase secrets set NUVANX_SUPABASE_SERVICE_ROLE_KEY="$(openssl rand -hex 32)"
supabase secrets set WHATSAPP_WEBHOOK_VERIFY_TOKEN="..."
npm run supabase:functions:deploy:api
```

### 4.3 Production data unblock sequence

Run these steps after deploying the Edge Function and secrets so dashboards do not remain at zero/null because of missing operational data:

```bash
# Fill Meta daily insights and attempt Lead Ads ingestion.
curl -X POST "https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/meta/backfill?days=90" \
  -H "Authorization: Bearer $NUVANX_SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-user-id: $REPORT_USER_ID"

# Ingest and normalize Doctoralia data, then run phone fallback matching if required.
npm run ingest:doctoralia
npm run doctoralia:match:phone

# Verify mandatory secrets after deployment.
curl "https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/health/secrets"
```

### 4.4 Frontend / Vercel

Variables necesarias:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY` (fallback)

El frontend usa `fetch('/api/...')` vía Vercel rewrite, no debe usar rutas antiguas directas.

### 4.5 GitHub Actions

Secrets necesarios por workflow:

- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID` (para backfills y reports)
- `DATABASE_URL`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `NUVANX_SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `GOOGLE_ADS_SERVICE_ACCOUNT`

## 5. Verificación

Endpoints a probar después de desplegar:

- `GET /api/health`
- `GET /api/health/meta`
- `GET /api/kpis`
- `GET /api/dashboard/metrics`
- `GET /api/dashboard/meta-trends`
- `GET /api/traceability/leads`
- `GET /functions/v1/daily-aggregates` (requiere Service Role Key)

SQL de verificación:

```sql
SELECT COUNT(*) FROM public.leads;
SELECT COUNT(*) FROM public.meta_daily_insights;
SELECT COUNT(*) FROM public.doctoralia_patients;
SELECT COUNT(*) FROM public.financial_settlements;
```

Scripts de verificación de salud:

```bash
# Ejecutar health check completo (Deno)
deno run --allow-net --allow-env scripts/health-check-nuvanx.ts
```

## 6. Comandos de arranque

Ejecutar en el repositorio raíz:

```bash
npm run install:all
npm run lint
npm run build
```

Verificar frontend local:

```bash
npm --prefix frontend run dev
```

Verificar backend local (Edge Function / supabase):

```bash
npm run supabase:functions:list
npm run supabase:migration:list
```

Si necesitas desplegar la función `api`:

```bash
npm run supabase:functions:deploy:api
```

## 7. GitHub Actions y secretos exactos

Valores que deben existir en GitHub Actions / Vercel según los workflows actuales:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_PASSWORD`
- `DATABASE_URL`
- `ENCRYPTION_KEY`
- `JWT_SECRET`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY`
- `VERCEL_TOKEN`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `META_APP_SECRET`
- `PRODUCTION_E2E_URL`
- `PRODUCTION_E2E_TOKEN`
- `GOOGLE_ADS_SERVICE_ACCOUNT`
- `DOCTORALIA_SHEET_ID`
- `DOCTORALIA_DRIVE_FILE_ID`
- `CLINIC_ID`
- `REPORT_USER_ID`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`

> Nota: algunos workflows aceptan `DATABASE_URL` como alternativa a `SUPABASE_DB_PASSWORD` + `SUPABASE_PROJECT_REF`.

## 8. Checklist final

- [ ] `git status --short` está limpio antes de empezar.
- [ ] `docs/setup-clean.md` revisado y compartido con el equipo de despliegue.
- [ ] `.env.example` y `frontend/.env.example` actualizados como plantillas semánticas.
- [ ] Los secrets de GitHub/Vercel están configurados y no contienen valores de prueba.
- [ ] `supabase db status` / `supabase migration list` confirma estado de migraciones.
- [ ] `supabase functions list` muestra la función `api` registrada.
- [ ] `npm --prefix frontend run build` pasa sin errores.
- [ ] `npm run supabase:functions:deploy:api` puede ejecutarse cuando el entorno productivo esté listo.
- [ ] Las rutas de verificación API devuelven `200` en el entorno local y en producción.
- [ ] No hay datos simulados en el backend o en los workflows.

## 9. Puntos de atención

- No inyectar datos reales en la DB de desarrollo sin respaldo.
- No usar archivos `.env` con credenciales de producción en el repositorio.
- Si se actualiza el token de Meta, hacerlo siempre con el script de tokens y la clave de cifrado correcta.
- Si se añaden nuevas integraciones, documentar el `service` y `metadata` esperado en `integrations`.

## 10. Automatización y Cron Jobs

Para mantener los datos actualizados, se recomienda programar las siguientes tareas en el entorno de producción.

### 10.1 Daily Aggregates (ROI, Rankings, Backfill)

Esta tarea recalcula métricas pesadas y sincroniza datos históricos de Doctoralia. Se ejecuta mediante una Edge Function.

**Edge Function:** `daily-aggregates`

**Programación recomendada (pg_cron en Supabase):**

```sql
-- Ejecutar todos los días a las 03:00 UTC
SELECT cron.schedule(
  'daily-nuvanx-aggregates',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url := 'https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/daily-aggregates',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'
    );
  $$
);
```

### 10.2 Health Check Automatizado

Se puede integrar el script `scripts/health-check-nuvanx.ts` en un workflow de GitHub Actions o en un cron diario para monitorizar la disponibilidad de los servicios críticos.
