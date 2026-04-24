# Nuvanx System

Revenue Intelligence Platform — Meta/Instagram lead acquisition → WhatsApp follow-up → appointment flow → Doctoralia settlement reconciliation.

## Architecture

- **Frontend**: React 19 + Vite → deployed to **Vercel**
- **Backend**: Supabase Edge Functions (primary API) + Express server (webhooks, credential vault)
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
| Google Ads | Active | Service account JWT; requires GOOGLE_ADS_SERVICE_ACCOUNT secret |
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

## Testing

```bash
npm run test:backend
cd backend && npx jest tests/auth.test.js --runInBand --forceExit
```

## CI/CD

- GitHub Actions CI: backend tests + frontend lint/build on every push to `main`
- Deploy: frontend → Vercel (auto), Edge Function → Supabase (manual: `npx supabase functions deploy api`)
- No Railway, no Render.

## Vercel environment variables

For Vercel production deploys, configure these environment variables in the frontend project settings:

- `VITE_SUPABASE_URL` — your Supabase project URL, e.g. `https://ssvvuuysgxyqvmovrlvk.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` — preferred Supabase publishable key from Supabase Connect
- `VITE_SUPABASE_ANON_KEY` — legacy anonymous key; used only as a fallback when `VITE_SUPABASE_PUBLISHABLE_KEY` is not set
- `VITE_API_BASE_URL` / `VITE_API_URL` — optional overrides for the API host; leave empty to use Vercel rewrite paths (`/api/*`)
- `VITE_SENTRY_DSN` — optional Sentry DSN for client error reporting

If neither Supabase key is set, the frontend will warn and disable Supabase features.

## Production URL

- Canonical dashboard URL: `https://frontend-arisofias-projects-c2217452.vercel.app/dashboard`
- Use the canonical alias for QA/UAT and incident verification.
- Treat hash-prefixed deployment URLs (`frontend-<hash>-...vercel.app`) as immutable snapshots for debugging only.

## Key Documentation

- [SECURITY.md](SECURITY.md) — Security posture and production readiness
- [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — Database setup and schema overview
- [docs/agents-and-integrations-architecture.md](docs/agents-and-integrations-architecture.md) — Architecture and agent roadmap
- [docs/production-validation-checklist.md](docs/production-validation-checklist.md) — Production secret and runtime verification checklist
- [docs/production-verification-recovery-2026-04-21.md](docs/production-verification-recovery-2026-04-21.md) — Canonical production URL, live deployment truth, and recovery actions

