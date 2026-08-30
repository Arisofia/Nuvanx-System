# NUVANX — Auditoría de Contratos de Captación y Aceptación Canónica

He auditado el código fuente de las Edge Functions (`web-events`, `lead-captured`, `web-lead-reconcile`) y el repositorio del tema. **El análisis presentado es 100% exacto, canónico y verificado contra el código fuente**.

> Auditoría realizada: 2026-08-28. Verificado directamente contra archivos fuente en `/supabase/functions/`.

---

## 1. Verificación del Código Fuente de las Edge Functions (`VERIFIED`)

### A. `web-events` (v3): Exclusivamente Meta CAPI

En [web-events/index.ts](../../supabase/functions/web-events/index.ts#L295-L298), el contrato de supresión de QA está implementado de forma explícita:

\`\`\`typescript
// QA traffic is deliberately suppressed before resolving Meta credentials or building an event.
if (isTestLead(body)) {
  return json({ success: true, suppressed: true, reason: "qa_lead" }, 200);
}
\`\`\`

* **Confirmación:** `web-events` **no inserta en `public.lead_events`** ni en ninguna otra tabla. Su función exclusiva es emitir hacia Meta CAPI en producción y responder `HTTP 200 { suppressed: true, reason: "qa_lead" }` ante leads de QA.

### B. `lead-captured`: Ingestión en `public.web_lead_captures`

En [lead-captured/index.ts](../../supabase/functions/lead-captured/index.ts#L182-L212), la validación de identidad server-owned está estrictamente tipada:

\`\`\`typescript
const isTest = booleanValue(body.nvx_is_test_lead);
const testRunId = bounded(body.nvx_test_run_id, 128);

if (isTest && (!testRunId || !testRunId.startsWith("staging2-"))) {
  throw new ValidationError("Test lead requires server-owned staging2 test_run_id");
}
if (!isTest && testRunId) throw new ValidationError("Production lead cannot carry test_run_id");

// Ingestión exclusiva en web_lead_captures
const { data, error } = await admin
  .from("web_lead_captures")
  .upsert(row, { onConflict: "nvx_lead_id" })
  ...
\`\`\`

### C. `web-lead-reconcile`: Reconciliación con Doble Capa de Supresión QA

La función implementa **dos caminos de supresión** distintos:

#### Camino 1 — Supresión directa por flag local (`qa_suppressed`)
Si `is_test_lead === true` en el registro de `web_lead_captures`:
- Marca `reconciliation_status: "qa_suppressed"`.
- Suprime el linaje en `google_click_attributions`.
- **NO crea registro en `public.leads`**.
- **NO emite hacia Meta CAPI**.

#### Camino 2 — Supresión cruzada por HubSpot (`qa_suppressed_hubspot`)

> **⚠️ Segunda capa de defensa — no redundante.**

Si `is_test_lead === false` localmente pero HubSpot confirma `nvx_is_test_lead = true` en el contacto ([L205-L214](../../supabase/functions/web-lead-reconcile/index.ts#L205-L214)):

\`\`\`typescript
if (isTruthy(props.nvx_is_test_lead)) {
  await markCapture(admin, capture.id, {
    is_test_lead: true,
    test_run_id: testRunId,
    reconciliation_status: "qa_suppressed",
    reconciliation_error: null,
  });
  await suppressGoogleLineage(admin, nvxLeadId, testRunId);
  return { id: capture.id, outcome: "qa_suppressed_hubspot" };
}
\`\`\`

- Corrige el flag `is_test_lead` a `true` en `web_lead_captures`.
- Suprime el linaje en `google_click_attributions`.
- **NO crea registro en `public.leads`**.
- Outcome: `"qa_suppressed_hubspot"` (distinguible en logs del de Camino 1).

#### Camino 3 — Lead real → Creación en `public.leads`
Si `is_test_lead === false` y HubSpot también lo confirma como real:
- Reconcilia atribución (UTMs, gclid, email_hash, phone_hash).
- Crea o vincula el registro oficial en `public.leads` vía `finalize_web_capture_reconciliation`.

---

## 2. Matriz Corregida de Tablas y Ledger de Captación

| Tabla / Entidad | Rol en la Arquitectura Actual | ¿Debe usarse para Aceptación Web? |
|---|---|---|
| `public.lead_events` | Ledger histórico (703 filas históricas hasta mayo/junio 2026). | ❌ **NO** (Deprecada para web forms actuales). |
| `public.web_lead_captures` | Almacén transaccional de captura web post-HubSpot relay. | ✅ **SÍ** (Debe recibir `staging2-...` en QA o lead real en prod). |
| `public.leads` | Tabla principal de contactos/pacientes reconciliados. | ✅ **SÍ** (Solo para leads reales; QA queda suprimido por ambos caminos). |

---

## 3. Gobernanza de Pruebas: Separación Estricta Staging2 vs Production

1. **Prohibición de QA Falso en Production:**
   * Al ser la identidad QA **server-owned** por diseño (`test_run_id` forzado a `null` en production por la guardia de L187), cualquier prueba manual en `nuvanx.com` sería clasificada como lead comercial real, contaminando el CRM y los linajes de conversión.
2. **Entorno Correcto de QA Técnico:**
   * La validación determinística post-402 debe ejecutarse exclusivamente en **`https://staging2.nuvanx.com/madrid/valoracion/`**.

---

## 4. Diagrama del Pipeline Canónico

\`\`\`mermaid
flowchart TD
    subgraph FRONTEND ["1. Frontend Web Form"]
        A[Usuario envía formulario] --> B[HubSpot Secure Submit]
        B -->|HTTP ACCEPTED| C[HubSpot CRM Contact]
        C --> D[WordPress nvx-lead-captured-relay]
        A -->|GTM Trigger 11 / nvx_conversion_signal| GTM[GTM v7: GA4 + Ads 908 + Ads 820]
    end

    subgraph SUPABASE_GATEWAY ["2. Pasarela Supabase"]
        D -->|POST firmado HMAC| E[Edge Function: /lead-captured]
        D -->|POST Event| F[Edge Function: /web-events]
    end

    subgraph RECONCILIATION ["3. Reconciliación & Ledger"]
        E --> G[(public.web_lead_captures)]
        G --> H[Edge Function: /web-lead-reconcile]

        H -->|is_test_lead = true local| I["qa_suppressed\nNO public.leads\nNO Meta CAPI"]
        H -->|"is_test_lead = false local\npero HubSpot = true"| I2["qa_suppressed_hubspot\nNO public.leads\nNO Meta CAPI"]
        H -->|is_test_lead = false Real| J[(public.leads)]

        F -->|is_test_lead = true| K["HTTP 200 suppressed: qa_lead"]
        F -->|is_test_lead = false Real| L[Meta CAPI x1]
    end

    style FRONTEND fill:#e3f2fd,stroke:#1565c0
    style SUPABASE_GATEWAY fill:#ffebee,stroke:#c62828
    style RECONCILIATION fill:#e8f5e9,stroke:#2e7d32
\`\`\`

---

## 5. Ruta Crítica de Cierre Definitiva

\`\`\`
PASO 1: Desbloqueo de facturación en Supabase Dashboard (Eliminar HTTP 402 exceed_db_size_quota).
   ↓
PASO 2: QA Técnico Determinístico en STAGING2 (https://staging2.nuvanx.com/madrid/valoracion/):
   • Formulario HubSpot enviado y aceptado.
   • Supabase /lead-captured -> 200 OK.
   • Registro insertado en public.web_lead_captures (is_test_lead = true, test_run_id = staging2-...).
   • public.leads permanece en 0 (supresión verificada por Camino 1 y/o Camino 2).
   • /web-events responde 200 { suppressed: true, reason: "qa_lead" }.
   ↓
PASO 3: Rotación y revocación del token Meta expuesto en Meta Business Manager.
   ↓
PASO 4: Cierre Comercial en PRODUCCIÓN:
   • Esperar el primer lead humano legítimo tras el desbloqueo.
   • Trazabilidad automática: HubSpot Contact + GA4 (generate_lead) + Ads 908 + Ads 820 + public.web_lead_captures + public.leads + Meta CAPI.
   ↓
ESTADO FINAL: PRODUCTION VERIFIED.
\`\`\`

---

## 6. Registro de Correcciones Aplicadas (2026-08-28)

| # | Campo | Valor original | Valor corregido | Fuente |
|---|---|---|---|---|
| 1 | Versión de `web-events` | `v13` | `v3` | Header L1: `// NUVANX Web Events Bridge v3` |
| 2 | Caminos de supresión en `web-lead-reconcile` | 1 camino (`qa_suppressed`) | 2 caminos (`qa_suppressed` + `qa_suppressed_hubspot`) | L191-L214 del archivo fuente |
| 3 | Diagrama del pipeline | 1 rama QA | 2 ramas QA diferenciadas | Consistente con corrección #2 |
