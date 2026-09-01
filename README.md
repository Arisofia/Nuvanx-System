# Nuvanx System

Revenue Intelligence and RevOps platform for NUVANX: paid-media acquisition, web/HubSpot lead capture, WhatsApp follow-up, appointment reconciliation, Doctoralia operational data, financial attribution and reporting.

## Architecture

- **Frontend:** React 19 + Vite, deployed as Cloudflare Workers Static Assets; Cloudflare Workers is the sole frontend runtime owner.
- **Production API:** Supabase Edge Function `supabase/functions/api/index.ts`.
- **MCP:** Supabase Edge Function `supabase/functions/mcp/index.ts`.
- **Database:** Supabase project `ssvvuuysgxyqvmovrlvk` (`nuvanx-prod`).
- **Operational automation:** GitHub Actions, `scripts/`, Supabase migrations and Edge Functions.
- **Legacy Node backend:** `backend/src/server.js` is not the production API owner.

Production behavior must be inferred from the active Edge Functions, migrations and workflows, not from historical audit files or retired one-shot tooling.

## Frontend routes

| Path | Purpose | Primary data path |
|---|---|---|
| `/dashboard` | Control centre and operational KPIs | Edge API / Supabase |
| `/live` | Lead and activity monitoring | Supabase Realtime + polling |
| `/crm` | Lead pipeline | Edge API |
| `/marketing` | Meta Ads and Google Ads intelligence | Edge API |
| `/financials` | Verified financial reporting | Edge API / settlement data |
| `/intelligence` | Attribution and funnel intelligence | Edge API |
| `/playbooks` | Automation playbooks | Edge API |
| `/integrations` | Server-side integration governance | Edge API |
| `/ai` | AI-assisted analysis and generation | Edge API |

## Active integration model

| Integration | Current ownership |
|---|---|
| Meta Lead Ads / Ads Insights | Server-side Meta integration, webhook and reporting paths |
| Meta CAPI | Server-side event delivery; credentials remain outside client code |
| WhatsApp Business | Server-side outbound/conversation path |
| HubSpot | Active server-side runtime bootstrap, web-lead reconciliation and Deal Factory integration |
| Google Ads | Server-side integration and connection-status diagnostics |
| Google click attribution | WordPress relay → Supabase attribution store; custom server-to-server HMAC hardening is governed cross-repository |
| Google Data Manager | Supabase outbox/worker model |
| Doctoralia | Google Sheets/service-account ingestion plus Supabase reconciliation; do not infer a live Doctoralia API connection from the schema alone |
| OpenAI / Gemini | Server-side credentialed integrations |
| GitHub | Repository/operational integration |

## Doctoralia data flow

The operational appointments flow reads the configured Google Sheet through service-account credentials. The canonical runtime configuration is provided by environment/secrets, including:

- `DOCTORALIA_SHEET_ID`
- `DOCTORALIA_APPOINTMENTS_SHEET_ID`
- `DOCTORALIA_DRIVE_FILE_ID`
- `DOCTORALIA_APPOINTMENTS_SHEET_NAME`
- `GOOGLE_DOCTORALIA_SERVICE_ACCOUNT`

Production uses fail-closed permission handling. The repository no longer recommends an anonymous/fail-open Apps Script webhook as the canonical sync path.

Patient status and matching semantics are governed by the applied Supabase migrations and the current Doctoralia audit contracts. Applied migrations are deployment history and must not be rewritten to perform normal forward fixes.

## Attribution and RevOps contract

The current attribution contract is documented in `docs/revops-attribution-contract-v1.md` and implemented by the active WordPress/Supabase paths. In particular:

- `nvx_lead_id` is episode/submission lineage, not a permanent patient identity.
- QA/test leads must not create operational downstream conversions.
- Google and Meta advertising events remain server-side and consent-aware.
- Doctoralia is a reconciliation/appointment source; it does not replace the canonical web lead-capture owner.

## Local setup

Install dependencies:

```bash
npm run install:all
```

Run the frontend locally:

```bash
npm run dev
```

Build, lint and test:

```bash
npm run build
npm run lint
npm run test
```

Run production smoke tests only with the required private environment configured:

```bash
npm run production:e2e
```

## Secrets

Never commit real credentials, tokens, private keys, connection strings or webhook secrets.

Use `.env.example` files only as empty templates. Local secret sources such as `.env.tokens.local` remain Git-ignored.

The canonical multi-platform synchronization utility is:

```bash
npm run secrets:sync:all
```

This is an explicit operator action. It can update configured remote secret stores, so inspect the target environment and local secret source before running it. The retired `set-meta-token.js` path must not be reintroduced as a second credential-rotation owner.

Useful read-only Meta diagnostics remain available:

```bash
npm run meta:audit -- --list --details
npm run meta:audit -- --insights 7
```

The daily orchestrator also performs the dedicated Meta access verification as a critical gate.

## Google Ads

The canonical application-level connection status is exposed through the server-side status path backed by `public.vw_google_ads_connection_status`. A persisted integration record is not by itself proof of a fresh successful Google Ads API request.

Run the server-side status diagnostic with the required private environment:

```bash
npm run google-ads:status
```

## Validation and CI

Common repository gates include:

```bash
npm run validate:workflows
npm run validate:migrations
npm run validate:daily-sync-config
npm run validate:doctoralia-appointments
npm run secrets:scan
```

The repository contains canonical GitHub Actions for master validation, standalone Edge Function deployment, scheduled Meta backfill and bounded maintenance operations. Do not add temporary builder/repair workflows to `main`; operational one-shots must be removed after their completion is proven.

## Deployment rules

- Database schema changes are forward-only Supabase migrations.
- Edge Function production ownership is the canonical repository source plus its deployment workflows.
- Do not manually recreate an Edge Function that canonical deployment has pruned unless the repository again contains an explicit owner.
- Do not edit or delete already-applied migration files as a normal remediation path.
- Do not expose service-role, Meta, HubSpot, Google, Doctoralia or other provider secrets to frontend code.

## Security incidents

Current-tree secret removal does **not** close a historical credential incident. History rewrite, credential rotation and fresh-clone secret scanning are separate closure requirements when a secret was committed historically.

See `SECURITY.md` and the relevant security/operations documentation before changing credential or deployment ownership.

## Key documentation

- `SECURITY.md` — security posture and production controls.
- `docs/revops-attribution-contract-v1.md` — current RevOps attribution contract.
- `docs/operations/google-access-inventory.md` — redacted Google ownership/access inventory.
- `docs/operations/google-ads-status-output.md` — Google Ads status ownership.
- `docs/production-validation-checklist.md` — production validation requirements.
- `docs/MCP.md` — MCP integration notes.
- `docs/setup-clean.md` — clean bootstrap guidance.

## Repository hygiene

Retain files that own an active runtime, validation gate, deployment, migration or operational contract. Historical one-shots and superseded docs should be removed only after their callers and replacement owners are verified. Applied migrations are intentionally retained even when old.
