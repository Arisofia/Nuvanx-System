# Nuvanx System

Revenue Intelligence Platform — Meta/Instagram lead acquisition → WhatsApp follow-up → appointment flow → Doctoralia settlement reconciliation.

## Project purpose

Nuvanx-System es una plataforma de inteligencia empresarial (BI) y automatización de marketing que integra múltiples capas de análisis de datos, gestión de campañas, inteligencia de CRM y automatización de flujos de trabajo mediante agentes de IA.

## Architecture

- **Frontend**: React 19 + Vite → deployed to **Vercel**
- **Production backend API**: Supabase Edge Function at `supabase/functions/api/index.ts`
- **MCP backend**: Supabase Edge Function at `supabase/functions/mcp/index.ts`
- **Legacy Node backend**: `backend/src/server.js` is a local legacy/placeholder server, not the production backend
- **Database**: Supabase (`ssvvuuysgxyqvmovrlvk` — nuvanx-prod)
- **Figma sync**: Secondary Supabase project (`zpowfbeftxexzidlxndy`)

## Frontend Routes

| Path | Page | Data source |
|---|---|---|
| `/dashboard` | Control centre — Meta KPIs, agent status, adaptive plan | Live API |
| `/live` | Real-time lead flow + activity feed | Supabase Realtime + polling |
| `/crm` | Lead pipeline — stages, DNI, lost_reason | Edge Function |
| `/marketing` | Meta Ads + Google Ads intelligence | Edge Function |
| `/financials` | Verified Financials — Doctoralia settlements, LTV | Edge Function |
| `/intelligence` | Campaign attribution, WhatsApp funnel, conversation log | Edge Function |
| `/playbooks` | Automation playbooks | Edge Function |
| `/integrations` | Credential vault — Meta, WhatsApp, OpenAI, Gemini, GitHub, Google Ads | Edge Function |
| `/ai` | AI content generation + campaign analysis | Edge Function |

## Active Integrations

| Integration | Status | Notes |
|---|---|---|
| Meta Lead Ads | Active | Webhook ingestion + Graph API attribution |
| WhatsApp Business | Active | Outbound send + conversation recording |
| Meta Ads Insights | Active | Campaign / adset / ad KPIs |
| Google Ads | Active | Service account JWT; requires GOOGLE_ADS_SERVICE_ACCOUNT secrets |
| OpenAI / Gemini | Active | Vault credential; used for AI content generation |
| GitHub | Active | Repo sync + stats |
| Doctoralia | Ingestion active | CSV upload → settlements table; no live API |
| HubSpot | **Purged** | Removed in migration `20260416170000` |

### Doctoralia Integration Configuration

- **Spreadsheet ID**: `1GAJoASGdjsKB7bTtC5hXPFkWbB7S4fVXhKD_cZoDwPw`
- **Sheet Name**: `Produccion Intermediarios` (gid: `2048254065`)
- **Column Mapping (0-indexed)**:
  - `0`: Estado | `1`: Fecha
  - `5`: Asunto (Source of ID, Name, Phone, and Treatment)
  - `6`: Agenda
  - `9`: Procedencia (Lead Source)
  - `10`: Importe

### Doctoralia Sheet Structure (for SQL integration and webhook sync)

The Google Sheets document also contains a "Doctoralia" tab (raw export) and "Listado" (patient master) for direct mapping to SQL tables.

#### 1. Tabla: `Doctoralia`
This table contains the detailed record of patient appointments and treatments.

| Columna              | Descripción                                                  | Tipo de Dato Sugerido (SQL)     |
| :------------------- | :----------------------------------------------------------- | :------------------------------ |
| **Estado**           | Estado de la cita (ej. Pendiente, Realizada).                | `VARCHAR(50)`                   |
| **Fecha**            | Fecha programada de la cita.                                 | `DATE`                          |
| **Hora**             | Rango horario de la cita.                                    | `VARCHAR(50)`                   |
| **Fecha creación**   | Fecha en la que se registró la cita.                         | `DATE`                          |
| **Hora creación**    | Hora del registro (puede contener valores nulos).            | `TIME`                          |
| **Asunto**           | Descripción completa que incluye ID, nombre y tratamiento.   | `TEXT`                          |
| **Agenda**           | Especialidad o profesional asignado (ej. Medicina Estética). | `VARCHAR(100)`                  |
| **Sala/Box**         | Ubicación física de la consulta.                             | `VARCHAR(50)`                   |
| **Confirmada**       | Indicador de confirmación (booleano o estado).               | `VARCHAR(20)`                   |
| **Procedencia**      | Origen del paciente (ej. Doctoralia, Directo).               | `VARCHAR(50)`                   |
| **Importe**          | Valor monetario del tratamiento o consulta.                  | `DECIMAL(10,2)`                 |
| **Fecha normalizar** | Fecha en formato estandarizado para procesamiento.           | `DATE`                          |
| **ID**               | Identificador único del paciente en esta tabla.              | `INT` (Clave Foránea potencial) |
| **Nombre**           | Nombre completo del paciente.                                | `VARCHAR(255)`                  |
| **Teléfono**         | Número de contacto.                                          | `VARCHAR(20)`                   |
| **Tratamiento**      | Tipo de procedimiento médico realizado.                      | `VARCHAR(255)`                  |
| **Día / Mes / Año**  | Componentes de la fecha desglosados.                         | `INT`                           |

#### 2. Tabla: `Listado`
This table functions as the patient master, containing demographic and contact information.

| Columna               | Descripción                                     | Tipo de Dato Sugerido (SQL) |
| :-------------------- | :---------------------------------------------- | :-------------------------- |
| **Nº**                | Identificador único del paciente (Primary Key). | `INT PRIMARY KEY`           |
| **Codigo cliente**    | Código interno adicional (suele estar vacío).   | `VARCHAR(50)`               |
| **Nombre**            | Nombre de pila del paciente.                    | `VARCHAR(100)`              |
| **Apellidos**         | Apellidos del paciente.                         | `VARCHAR(100)`              |
| **DNI**               | Documento Nacional de Identidad o Pasaporte.    | `VARCHAR(20)`               |
| **Edad**              | Edad del paciente.                              | `INT`                       |
| **Sexo**              | Género del paciente.                            | `VARCHAR(20)`               |
| **Email**             | Correo electrónico de contacto.                 | `VARCHAR(150)`              |
| **Tel. móvil**        | Número de teléfono principal.                   | `VARCHAR(20)`               |
| **Direccion**         | Domicilio del paciente.                         | `TEXT`                      |
| **Localidad / Prov.** | Ubicación geográfica.                           | `VARCHAR(100)`              |
| **Primera visita**    | Fecha de la primera interacción con la clínica. | `DATE`                      |
| **Última visita**     | Fecha de la actividad más reciente.             | `DATE`                      |

**SQL Considerations**:
* **Relation**: Link both tables using the `ID` field from the `Doctoralia` table with the `Nº` field from the `Listado` table.
* **Data Cleaning**: Numeric fields like `Importe` or `Edad` may require cleaning to remove non-numeric characters before import.
* **Dates**: Convert all date columns to ISO `YYYY-MM-DD` standard format.

#### Formulas for "Doctoralia" Sheet (columns M-T, set as ARRAYFORMULA in row 1)

**Importante:** Coloca estas fórmulas en la **celda 1** de cada columna (M1, N1, etc.) y borra el resto de la columna. Esto incluye el encabezado + la fórmula ARRAYFORMULA para todas las filas de datos. El script webhook solo escribe columnas A-L, por lo que las fórmulas de M-T se preservan en updates y se expanden automáticamente en inserts.

| Columna | Encabezado   | Fórmula (pegar en la celda **1** de la columna, ej. M1) |
| :------ | :----------- | :----------------------------------------------------- |
| **M**   | **ID**       | `={"ID"; ARRAYFORMULA(IF(F2:F=""; ""; IFERROR(REGEXEXTRACT(F2:F; "^(\d+)"); "")))}` |
| **N**   | **Nombre**   | `={"Nombre"; ARRAYFORMULA(IF(F2:F=""; ""; IFERROR(REGEXEXTRACT(F2:F; "^\d+\.\s+(.*?)\s+\["); "")))}` |
| **O**   | **Teléfono** | `={"Teléfono"; ARRAYFORMULA(IF(F2:F=""; ""; IFERROR(REGEXEXTRACT(F2:F; "\[(.*?)\]"); "")))}` |
| **P**   | **Tratamiento** | `={"Tratamiento"; ARRAYFORMULA(IF(F2:F=""; ""; IFERROR(REGEXEXTRACT(F2:F; "\((.*?)\)\s*$"); "")))}` |
| **Q**   | **Día**      | `={"Día"; ARRAYFORMULA(IF(B2:B=""; ""; DAY(B2:B)))}` |
| **R**   | **Mes**      | `={"Mes"; ARRAYFORMULA(IF(B2:B=""; ""; MONTH(B2:B)))}` |
| **S**   | **Año**      | `={"Año"; ARRAYFORMULA(IF(B2:B=""; ""; YEAR(B2:B)))}` |
| **T**   | **Clínica**  | `={"Clínica"; ARRAYFORMULA(IF(N2:N=""; ""; IFS(ISNUMBER(SEARCH("Esquivel";N2:N)); "Clínica Esquivel"; OR(ISNUMBER(SEARCH("C Clinic";N2:N)); ISNUMBER(SEARCH("CClinic";N2:N))); "CClinic"; OR(ISNUMBER(SEARCH("Alcala";N2:N)); ISNUMBER(SEARCH("Alcalá";N2:N))); "Clínica Alcalá"; OR(ISNUMBER(SEARCH("D´Cadiz";N2:N)); ISNUMBER(SEARCH("Cadíz";N2:N))); "Clínica D Cadíz"; OR(ISNUMBER(SEARCH("Aesthetic Bar";N2:N)); ISNUMBER(SEARCH("Aestetic";N2:N))); "Aesthetic Bar"; ISNUMBER(SEARCH("Leganes";N2:N)); "Sonia Leganés"; ISNUMBER(SEARCH("Arroyomolinos";N2:N)); "Clinica Arroyomolinos"; ISNUMBER(SEARCH("Rivera";N2:N)); "Clínica Rivera"; TRUE; "NUVANX Medicina Estética Láser")))}` |

**Notas sobre las fórmulas:**
- Se usan en fila 1 con el patrón `={"Encabezado"; ARRAYFORMULA(...)}` para autocompletar el header y los datos.
- La columna **T (Clínica)** usa coincidencias por nombre (columna N) para asignar la clínica correspondiente. Ajusta los patrones `SEARCH` según tus nombres reales de pacientes/clínicas.
- Estas fórmulas se calculan automáticamente en Google Sheets sin que el script las toque (el script solo actualiza/inserta A-L).

#### Webhook Script for Doctoralia Sheet Sync (Supabase → Google Sheets)

For robust sync, use this Google Apps Script as Web App (see deployment steps below).

```javascript
/**
 * WEBHOOK PARA DOCTORALIA - SINCRONIZACIÓN SUPABASE
 */
const SHEET_NAME = "Doctoralia";
const SECRET_HEADER = "X-Webhook-Secret"; // Opcional pero recomendado

// === CONFIGURACIÓN DE SEGURIDAD ===
// Recomendado: Guardar el secreto en "Project settings → Script properties"
// Clave: WEBHOOK_SECRET
// Valor: (la misma clave que configuras en el Webhook de Supabase)
const EXPECTED_SECRET = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') || '';

function doPost(e) {
  try {
    // 1. Verificación de contenido
    if (!e || !e.postData || !e.postData.contents) return createResponse("No content", 400);

    // 2. Seguridad (solo si se configuró un secreto)
    if (EXPECTED_SECRET) {
      const headers = e.headers || {};
      const receivedSecret =
        e.parameter?.[SECRET_HEADER] ||
        headers[SECRET_HEADER] ||
        headers[SECRET_HEADER.toLowerCase()] ||
        headers['x-webhook-secret'] ||
        '';
      if (receivedSecret !== EXPECTED_SECRET) return createResponse("Unauthorized", 401);
    }

    const payload = JSON.parse(e.postData.contents);
    const record = payload.record; // Datos desde Supabase
    if (!record || !record.asunto) return createResponse("No record data", 400);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return createResponse("Sheet not found", 404);

    // 3. Mapeo de columnas A:L (solo estas se escriben vía script)
    // Las columnas M-T (ID, Nombre, Teléfono, Tratamiento, Día/Mes/Año, Clínica, etc.)
    // se gestionan con ARRAYFORMULA en la propia hoja (ver fórmulas recomendadas arriba).
    // Esto evita sobrescribir fórmulas al hacer updates y mantiene la hoja ligera.
    const rowData = [
      record.estado || "Pendiente",       // A
      record.fecha || "",                // B
      record.hora || "",                 // C
      record.fecha_creacion || "",       // D
      record.hora_creacion || "",        // E
      record.asunto.trim(),              // F (Clave única)
      record.agenda || "",               // G
      record.sala_box || "Sin asignar",  // H
      record.confirmada || "",           // I
      record.procedencia || "-",         // J
      record.importe || 0,               // K
      record.fecha_para_normalizar || "" // L
    ];

    // 4. Lógica de Upsert (Evitar duplicados usando la columna F)
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === String(record.asunto).trim()) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex !== -1) {
      // Actualiza fila existente (Columnas A a L únicamente; M-T quedan intactas)
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    } else {
      // Añade fila nueva (las fórmulas ARRAYFORMULA de M-T se expandirán solas)
      sheet.appendRow(rowData);
    }

    return createResponse("Success", 200);

  } catch (err) {
    return createResponse("Error: " + err.toString(), 500);
  }
}

function createResponse(message, code) {
  return ContentService.createTextOutput(JSON.stringify({
    status: message, code: code, timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
```

#### Deployment Steps for the Webhook

1. Copy the script above into a new Google Apps Script project (or the script bound to your target spreadsheet).
2. In Apps Script: **Project settings → Script properties** → Add a property named `WEBHOOK_SECRET` with a strong secret value. Remember this value.
3. **Deploy > New deployment** > Type: **Web App**. Execute as: You; Access: Anyone.
4. Copy the Web App URL.
5. **Set up derived columns (M-T):** In your "Doctoralia" sheet, paste the ARRAYFORMULA formulas documented in the section above into cells M1, N1, ..., T1 (clear the rest of those columns first). These will auto-populate ID, Nombre, Teléfono, Tratamiento, dates, and Clínica based on the "Asunto" (col F) without the script touching them.
6. In Supabase: Create Database Webhook for the relevant table (e.g. `produccion_intermediarios` or `doctoralia_raw`) pointing to the URL, with Header `X-Webhook-Secret: <the exact WEBHOOK_SECRET value you set>`.

This keeps the "Doctoralia" sheet in sync with Supabase. The script writes only A-L; the ARRAYFORMULAs in M-T parse/enrich the Asunto (and other fields) automatically on every insert/update.

## Revenue Truth Model

- `leads.revenue` = **estimated** (entered manually in CRM, never verified)
- `financial_settlements.amount_net` = **verified** (Doctoralia settled operations, financing-only)
- Dashboard revenue KPI shows estimated CRM values. Verified revenue is under `/financials` only.
- DNI is the deterministic reconciliation key between leads and settlements. Currently populated only from Doctoralia CSV uploads, not from Meta webhooks.

## Development

```bash
npm run install:all
npm run dev:backend   # Express server on :3001 (webhooks + credential vault)
npm run dev:frontend  # Vite on http://localhost:5173
```

### Local Meta script credentials
Para ejecutar los scripts locales de Meta y generar reportes, copia `.env.example` a `.env.local` o exporta estas variables en tu shell:

### Environment Setup Hierarchy
The system uses the following priority for loading environment variables:
1. **`.env.tokens.local`**: Primary source for production-ready secrets and platform sync (Git-ignored).
2. **`.env.local`**: Local frontend overrides.
3. **`.env`**: General fallbacks.

**Action Required**: If you have a `config.env` file, rename it to `.env.tokens.local` to ensure local scripts can access the vault.

```bash
export META_ACCESS_TOKEN=...
export META_AD_ACCOUNT_ID=act_...
export DATABASE_URL=postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require
# IMPORTANT: Always use the Session Pooler host (not the direct db.<ref>.supabase.co which is IPv6-only for this project).
export CLINIC_ID=...
```

Para actualizar el token de Meta en los `.env` locales detectados, usa:

```bash
npm run update:meta-token
```

Para verificar el acceso y auditar las cuentas Meta configuradas, usa:

```bash
npm run meta:audit -- --list --details
npm run meta:audit -- --insights 7
```

Si quieres propagar el token también a GitHub, Supabase y Vercel desde el mismo script, ejecuta:

```bash
META_ACCESS_TOKEN_NEW=<new_token> node scripts/set-meta-token.js --github --supabase --vercel
```

El script actualizará `META_ACCESS_TOKEN` en los archivos `.env` detectados sin modificar otras variables.

Si prefieres hacerlo manualmente, sincroniza los entornos remotos así:

- Supabase:
  ```bash
  supabase secrets set META_ACCESS_TOKEN="..."
  # Note: If you get a "privileges" error, set these via the Supabase Dashboard: Settings > Edge Functions > Secrets
  # Nota: Usa un ID de cuenta (ej. 9523446201036125), NO el App ID.
  # Si recibes error de "privileges", configura esto en el Dashboard (Settings > Edge Functions > Secrets).
  supabase secrets set FALLBACK_META_AD_ACCOUNT_ID="9523446201036125"
  npm run supabase:functions:deploy:api
  npm run supabase:functions:deploy:mcp
  ```
- GitHub Actions:
  ```bash
  gh secret set META_ACCESS_TOKEN --body "..."
  ```
- Vercel:
  ```bash
  vercel env add META_ACCESS_TOKEN production --value "..." --yes
  ```
  Nota: este comando requiere que el directorio esté vinculado a un proyecto de Vercel (`vercel link`).

`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `DATABASE_URL` y `CLINIC_ID` son requeridos por los scripts de orquestación y monitoreo del repositorio.

## Testing

```bash
npm run test:backend
cd backend && npx jest tests/auth.test.js --runInBand --forceExit
npm --prefix frontend run test:ci
```

## CI/CD

- GitHub Actions CI: backend tests + frontend lint/build on every push to `main`
- Deploy: frontend → Vercel (auto), Edge Function → Supabase (manual: `npx supabase functions deploy api`)
- No Railway or Render deployments are used.

## Project maturity

- Puntuación técnica: **6.5 / 10**
- Estado: **Emergente a Creciente**
- El proyecto tiene una base sólida, pero requiere inversión en arquitectura, testing y automatización para ser production-ready a escala.
- Documentación adicional: [Project Purpose](docs/project-purpose.md)

## GitHub Actions secrets

The repository uses GitHub Actions secrets for Supabase and production validation workflows:

- `SUPABASE_ACCESS_TOKEN` — Supabase personal access token for CLI operations. Must be a valid `sbp_...` token.
- `SUPABASE_PROJECT_REF` — Target Supabase project ref for `supabase link`.
- `SUPABASE_DB_PASSWORD` — Optional DB password used when `DATABASE_URL` is unavailable (fallback constructs Session Pooler URL).
- `DATABASE_URL` — Postgres connection string. **Must use Session Pooler** (e.g. `postgresql://postgres.<ref>:<pw>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require`). Direct `db.<ref>.supabase.co` is IPv6-only and unreliable.
- `PRODUCTION_E2E_URL` — Production API base URL used by automated smoke tests.
- `PRODUCTION_E2E_TOKEN` — Auth token used by `scripts/production-e2e.js`.
- `GOOGLE_ADS_SERVICE_ACCOUNT` — Google Sheets service account JSON for Doctoralia sync.
- `DOCTORALIA_SHEET_ID` / `DOCTORALIA_DRIVE_FILE_ID` — Spreadsheet ID used for Doctoralia ingestion.
- `MCP_API_KEY` — API key for authenticating to /mcp Edge Function (and scripts/health-check-nuvanx.ts).
- `FALLBACK_META_AD_ACCOUNT_ID` — Required fallback Meta ad account ID (numeric or act_ form) for lead attribution paths. No longer has hardcoded default; must be set in Supabase Dashboard (Edge Function secrets) after fix #6. Use `supabase secrets set FALLBACK_META_AD_ACCOUNT_ID="..."`.

## Vercel environment variables

For Vercel production deploys, configure these environment variables in the frontend project settings:

- `VITE_SUPABASE_URL` — your Supabase project URL, e.g. `https://<SUPABASE_PROJECT_REF>.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` — preferred Supabase publishable key from Supabase Connect
- `VITE_SUPABASE_ANON_KEY` — legacy anonymous key; used only as a fallback when `VITE_SUPABASE_PUBLISHABLE_KEY` is not set
- `VITE_API_BASE_URL` / `VITE_API_URL` — optional overrides for the API host; leave empty to use Vercel rewrite paths (`/api/*`)
- `VITE_SENTRY_DSN` — optional Sentry DSN for client error reporting

Use `.env.example` and `frontend/.env.example` only as templates; do not commit real credentials to version control.

If neither Supabase key is set, the frontend will warn and disable Supabase features.

## Production URL

- Canonical dashboard URL: `https://frontend-arisofias-projects-c2217452.vercel.app/dashboard`
- Use the canonical alias for QA/UAT and incident verification.
- Treat hash-prefixed deployment URLs (`frontend-<hash>-...vercel.app`) as immutable snapshots for debugging only.

## Key Documentation

- [SECURITY.md](SECURITY.md) — Security posture and production readiness
- [docs/agents-and-integrations-architecture.md](docs/agents-and-integrations-architecture.md) — Architecture and agent roadmap
- [docs/production-validation-checklist.md](docs/production-validation-checklist.md) — Production secrets and runtime verification checklist
- [docs/MCP.md](docs/MCP.md) — MCP server URL, tools, Grok connector setup, and security notes
- [docs/lead-reconciliation-validation.md](docs/lead-reconciliation-validation.md) — Manual validation for `?reconcile=true` lead reconciliation and Lead Audit matching semantics
- [docs/setup-clean.md](docs/setup-clean.md) — Clean bootstrap / zero-to-production setup guide
