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

```bash
export META_ACCESS_TOKEN=...
export META_AD_ACCOUNT_ID=act_...
export DATABASE_URL=postgresql://user:password@host:port/dbname
export CLINIC_ID=...
```

Para actualizar el token de Meta en los `.env` locales detectados, usa:

```bash
npm run update:meta-token
```

Si quieres propagar el token también a GitHub, Supabase y Vercel desde el mismo script, ejecuta:

```bash
META_ACCESS_TOKEN_NEW=REPLACE_ME node scripts/set-meta-token.js --github --supabase --vercel
```

El script actualizará `META_ACCESS_TOKEN` en los archivos `.env` detectados sin modificar otras variables.

Si prefieres hacerlo manualmente, sincroniza los entornos remotos así:

- Supabase:
  ```bash
  supabase secrets set META_ACCESS_TOKEN="..."
  npm run supabase:functions:deploy:api
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

`META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `DATABASE_URL` y `CLINIC_ID` son requeridos por `scripts/meta-daily-report.js` y `scripts/meta-weekly-report.js`.

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

- `SUPABASE_ACCESS_TOKEN` — Supabase personal access token for CLI operations.
- `SUPABASE_PROJECT_REF` — Target Supabase project ref for `supabase link`.
- `SUPABASE_DB_PASSWORD` — Optional DB password used when `DATABASE_URL` is unavailable.
- `DATABASE_URL` — Optional Postgres connection string used for migrations and linting.
- `PRODUCTION_E2E_URL` — Production API base URL used by automated smoke tests.
- `PRODUCTION_E2E_TOKEN` — Auth token used by `scripts/production-e2e.js`.
- `GOOGLE_ADS_SERVICE_ACCOUNT` — Google Sheets service account JSON for Doctoralia sync.
- `DOCTORALIA_SHEET_ID` / `DOCTORALIA_DRIVE_FILE_ID` — Spreadsheet ID used for Doctoralia ingestion.

## Vercel environment variables

For Vercel production deploys, configure these environment variables in the frontend project settings:

- `VITE_SUPABASE_URL` — your Supabase project URL, e.g. `https://YOUR_SUPABASE_PROJECT_REF.supabase.co`
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
- [docs/setup-clean.md](docs/setup-clean.md) — Clean bootstrap / zero-to-production setup guide


