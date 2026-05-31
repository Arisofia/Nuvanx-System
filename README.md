# Nuvanx System

Revenue Intelligence Platform — Meta/Instagram lead acquisition → WhatsApp follow-up → appointment flow → Doctoralia settlement reconciliation.

## Project purpose

Nuvanx-System es una plataforma de inteligencia empresarial (BI) y automatización de marketing que integra múltiples capas de análisis de datos, gestión de campañas, inteligencia de CRM y automatización de flujos de trabajo mediante agentes de IA.

## Architecture

- **Frontend**: React 19 + Vite → deployed to **Vercel**
- **Production backend API**: Supabase Edge Function at `supabase/functions/api/index.ts`
- **MCP backend**: Supabase Edge Function at `supabase/functions/mcp/index.ts`
- **Legacy Node backend**: Previously existed as `backend/src/server.js` (local only). It has been removed — the production backend is now fully on Supabase Edge Functions (`supabase/functions/api/index.ts`).
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

## Revenue Truth Model

- `leads.revenue` = **estimated** (entered manually in CRM, never verified)
- `financial_settlements.amount_net` = **verified** (Doctoralia settled operations, financing-only)
- Dashboard revenue KPI shows estimated CRM values. Verified revenue is under `/financials` only.
- DNI is the deterministic reconciliation key between leads and settlements. Currently populated only from Doctoralia CSV uploads, not from Meta webhooks.

## Development

```bash
npm run install:all
npm run dev:frontend  # Vite on http://localhost:5173 (proxies /api to Supabase Edge Functions locally)
```

The legacy Express backend (`backend/src/server.js`) was fully removed. Production backend is now 100% on Supabase Edge Functions (`supabase/functions/api/index.ts` and others).

### Local development & scripts
- Frontend + API proxy: `npm run dev:frontend`
- Doctoralia sync script: `node scripts/sync-doctoralia.js` (requires proper env vars)
- Daily orchestrator: `node scripts/run-daily-sync.js`
- Secret sync helper: `node scripts/sync-platform-secrets.js`

### Environment Setup Hierarchy
The system uses the following priority for loading environment variables:
1. **`.env.tokens.local`**: Primary source for production-ready secrets and platform sync (Git-ignored).
2. **`.env.local`**: Local frontend overrides.
3. **`.env`**: General fallbacks.

**Action Required**: If you have a `config.env` file, rename it to `.env.tokens.local` to ensure local scripts can access the vault.

For most scripts the critical variables are:
```bash
export DATABASE_URL=...
export CLINIC_ID=...
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
# Plus provider-specific ones (META_*, GOOGLE_*, etc.)
```

Manual secret sync examples:
- Supabase: `supabase secrets set KEY="value"`
- GitHub Actions: `gh secret set KEY --body "value"`
- Vercel: `vercel env add KEY production --value "..." --yes` (requires `vercel link`)

## Testing

```bash
npm --prefix frontend run test:ci
# Backend tests now live primarily in Supabase Edge Functions (api/index.ts) and scripts (e.g. phone-normalization.test.js)
```

## CI/CD

- GitHub Actions CI: frontend lint/build + secret scanning + workflow validation on every push to `main`
- Deploy: frontend → Vercel (automatic), Edge Functions + migrations → Supabase (via `daily-sync.yml`, `deploy.yml` and manual `supabase functions deploy`)
- No Railway or Render deployments are used. All production backend runs on Supabase Edge Functions.

## Project maturity

- Puntuación técnica: **7.5 / 10** (updated after major RLS, CAPI, workflow hardening and secret hygiene work in 2026)
- Estado: **Creciente → Production hardening phase**
- The project has a solid foundation with strong automation (Doctoralia ↔ Supabase ↔ CAPI bidirectional flows, daily orchestrator, secret sync tooling) and hardened security posture.
- Most critical documentation now lives in code comments, the few maintained .md files listed above, and the architecture diagram. Large amounts of historical/outdated docs were removed during aggressive cleanup.

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

## Key Documentation (current & maintained)

- [docs/architecture.md](docs/architecture.md) + [docs/architecture.mmd](docs/architecture.mmd) — High-level architecture + canonical Mermaid diagram (single source of truth)
- [docs/sql/rls_hardening_and_traceability_summary.md](docs/sql/rls_hardening_and_traceability_summary.md) — Final state of RLS hardening, traceability views, CAPI columns and migration hygiene (June 2026)
- [docs/daily_sync_meta_access_diagnosis.md](docs/daily_sync_meta_access_diagnosis.md) — Historical diagnosis of daily sync / Meta access issues (kept for traceability; marked obsolete)
