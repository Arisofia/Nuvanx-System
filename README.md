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

## Key Documentation

- [SECURITY.md](SECURITY.md) — Security posture and production readiness
- [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — Database setup and schema overview
- [docs/agents-and-integrations-architecture.md](docs/agents-and-integrations-architecture.md) — Architecture and agent roadmap

