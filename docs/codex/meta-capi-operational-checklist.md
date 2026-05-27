# Meta/CAPI Operational Checklist (External Configuration)

> Scope: production operations that cannot be solved only with code changes.
> Last updated: 2026-05-20.

## 1) Meta API `conversions = 0`

**Where:** Meta Events Manager → Pixel `1405503384615251` (account `act_9523446201036125`).

**Required action:**
1. Open **Events Manager** and select Pixel `1405503384615251`.
2. Confirm event **Lead** (or **Contact**, if that is your standard) is:
   - Active,
   - Recently received,
   - Eligible for optimization.
3. Confirm attribution settings/window in Ads Manager match dashboard reporting windows.

**Expected result:** New attributed conversions appear in Meta reporting endpoints; dashboard no longer remains hard-zero when spend exists.

---

## 2) `fbc` empty in leads

**Where:** Meta Lead Gen form and landing URL strategy.

**Required action:**
1. Ensure destination/landing URL preserves query string parameter `fbclid`.
2. Validate browser capture path in frontend (`metaPixel.ts`) by opening a URL with `?fbclid=test123`.
3. Submit a test lead and verify `leads.fbc` is non-null.

**Expected result:** `fbc` is populated for click-driven leads, improving CAPI match quality (EMQ).

---

## 3) `act_4172099716404860` with spend but 0 leads

**Where:** Meta Ads Manager for account `act_4172099716404860`.

**Required action:**
1. Review campaign objective (Leads vs Awareness/Traffic).
2. If objective is not lead-optimized, reconfigure campaign objective/event mapping.
3. Confirm form destination and event mapping are aligned to Lead/Contact.

**Expected result:** Account-level leads stop remaining structurally zero while spend accrues.

---

## 4) `agent_outputs = 0` rows

**Where:** Frontend playbook execution with valid authenticated JWT.

---

## 5) Duplicate Purchase events in Meta (CAPI guard)

**Where:** `produccion_intermediarios` table + `handleSupabaseWebhook`.

**New guard:** Column `capi_sent` (boolean, default false).

**Monitoring query** (run in Supabase SQL editor or via the new anomaly script):

```sql
SELECT id, created_at, estado, importe, phone_normalized, clinic_id, capi_sent
FROM public.produccion_intermediarios
WHERE estado ILIKE '%pagada%'
  AND (capi_sent IS FALSE OR capi_sent IS NULL)
ORDER BY created_at DESC;
```

**Expected behavior after deployment:**
- A "Pagada" row triggers a CAPI `Purchase` event **only once**.
- After successful send, `capi_sent` is set to `true`.
- Re-entrancy or webhook retries no longer duplicate events in Meta.

---

## 6) CAPI Quality Monitoring Endpoint

**New protected route:** `GET /capi/quality` (authenticated).

Use this endpoint (or the daily sync quality logs) for post-deployment validation of EMQ health.

**Key signals to watch:**
- Recent Purchase events from paid productions.
- % of recent leads carrying `fbc` + `fbp`.
- Pixel routing per ad account (`9523446201036125` vs `4172099716404860`).

**Recommended cadence:** Check after each deployment and daily via the orchestrator logs (`[sync-doctoralia] Daily data quality for CAPI`).

---

## 7) Anomaly Dashboard (Pagada sin enviar)

Create or schedule the query from `docs/capi/capi_anomaly_detection_pagada_not_sent.sql` as a recurring check or Supabase scheduled function to surface any "Pagada" rows that never received their CAPI Purchase event.

**Automation tip**: Add a Supabase Scheduled Function or GitHub cron that runs this query daily and posts results to Telegram/Slack if any rows are found.

**Recommended CLI method** (fully scriptable):
```bash
SHEETS_WEBHOOK_URL="https://script.google.com/..." \
SHEETS_WEBHOOK_SECRET="tu-clave-secreta" \
SUPABASE_ACCESS_TOKEN="sbp_xxx" \
SUPABASE_PROJECT_REF="ssvvuuysgxyqvmovrlvk" \
node scripts/setup-supabase-webhooks.js
```

---

## 8) Google Apps Script para espejo en tiempo real (Produccion Intermediarios)

Usa el script robusto ubicado en:
`docs/google-apps-script/webhook-produccion-intermediarios.js`

**Mejoras incluidas vs versión básica:**
- Manejo de errores con try/catch + logging claro
- Validación de payload
- Soporte para header de secreto (`X-Webhook-Secret`)
- Función de prueba (`testDoPost`)
- Comentado para no sincronizar `capi_sent` por defecto (puedes activarlo fácilmente)

Sigue los pasos del consultor para desplegarlo como Aplicación Web y crear el segundo Database Webhook en Supabase.

---

## 9) Full End-to-End Automation Requirements

For the entire flow to trigger **automatically** (no manual steps):

1. **Daily Doctoralia Sync** (already automated via GitHub Actions cron in `daily-sync.yml`).
2. **Supabase Database Webhook** (must be configured once in Dashboard):
   - Go to Supabase Dashboard → Database → Webhooks
   - Create webhook on table `produccion_intermediarios`
   - Events: `INSERT` + `UPDATE`
   - Filter (optional): `estado = 'pagada'`
   - POST to: `https://<project-ref>.supabase.co/functions/v1/api/webhooks/supabase`
   - Use `service_role` key as Authorization (secret).
3. **capi_sent guard** (already implemented) ensures idempotency.
4. **Monitoring**:
   - Daily sync logs include CAPI quality metrics.
   - Use `/capi/quality` endpoint regularly.
   - Anomaly query via the helper script `scripts/check-capi-pending-pagadas.js`.

Once the Database Webhook (step 2) is created, the flow "Doctoralia export → sync → 'pagada' → CAPI Purchase (one time only)" runs 100% automatically.

**Required action:**
1. Obtain a real authenticated JWT (non-anonymous) for a production user.
2. Execute one playbook run from `/playbooks` UI **or** via API call:

```bash
curl -X POST "${SUPABASE_URL}/functions/v1/api/playbooks/<slug>/run" \
  -H "Authorization: Bearer ${REAL_USER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

3. Validate persistence in DB:

```sql
select id, user_id, clinic_id, agent_type, created_at
from public.agent_outputs
order by created_at desc
limit 20;
```

**Expected result:** API returns `success: true` and at least one new row is visible in `agent_outputs`.

---

## Audit closure criteria

Mark the incident as closed only when **all** conditions are true:
- Pixel `1405503384615251` receives Lead/Contact events in real time.
- New CAPI-trackable leads have non-null `fbc` where applicable.
- Account `act_4172099716404860` has objective-event alignment for lead generation.
- `agent_outputs` receives rows from a JWT-authenticated playbook run.
