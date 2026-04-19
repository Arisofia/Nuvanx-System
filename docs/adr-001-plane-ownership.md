# ADR-001 — Plane Ownership

Date: 2026-04-19
Status: Accepted

## Context

The Nuvanx system has two possible execution planes:

1. **Express backend** (`backend/src/`) — HTTP server running on a managed host (Railway / Render).
2. **Supabase Edge Functions** — serverless functions co-located with the database.

Without clear rules, business logic drifts to both planes, creating duplicate audit trails, split
credential access, and untestable side effects.

## Decision

**Express is the canonical execution plane** for all of:

- Webhook ingestion (Meta Lead Ads, WhatsApp Business inbound events)
- Outbound side effects (WhatsApp message sends, Meta Graph API calls)
- Long-running and retried jobs (playbook runner, Doctoralia batch ingestion)
- Reconciliation and aggregation writes
- DB mutations originating from external systems (Doctoralia, Meta, GitHub)
- Any operation that reads from or writes to the encrypted credential vault

**Supabase Edge is a thin read facade** only for:

- Realtime subscriptions to DB tables (`supabase.channel`)
- Direct RLS-secured reads from the frontend where sub-millisecond latency matters
- Lightweight read endpoints that contain no business logic and no side effects

**Enforcement rule:** Any Edge function that duplicates an Express route's write logic must be
deleted and the frontend updated to call the Express route instead.  New integrations always land
in Express first.

## Canonical Backend Route Registry

All Express routes registered in `backend/src/server.js` as of 2026-04-19:

| Route prefix | File | Plane | Description |
|---|---|---|---|
| `POST/GET /api/webhooks/meta` | `routes/webhooks.js` | Express | Meta Lead Ads + WhatsApp inbound events |
| `POST /api/auth/*` | `routes/auth.js` | Express | Registration, login, JWT issuance |
| `* /api/credentials/*` | `routes/credentials.js` | Express | Encrypted API key vault (AES-256) |
| `* /api/integrations/*` | `routes/integrations.js` | Express | Integration catalog + health checks |
| `* /api/leads/*` | `routes/leads.js` | Express | CRM lead CRUD |
| `GET /api/dashboard` | `routes/dashboard.js` | Express | Dashboard metrics |
| `POST /api/ai/*` | `routes/ai.js` | Express | AI content generation + lead scoring |
| `POST /api/whatsapp/*` | `routes/whatsapp.js` | Express | WhatsApp send + phone configuration |
| `GET /api/figma/*` | `routes/figma.js` | Express | Figma sync events |
| `POST /api/github/*` | `routes/github.js` | Express | GitHub repo sync |
| `GET/POST /api/playbooks/*` | `routes/playbooks.js` | Express | Playbook definitions + run trigger |
| `GET /api/meta/*` | `routes/meta.js` | Express | Meta Ads Insights |
| `GET /api/financials/*` | `routes/financials.js` | Express | Verified financials (Doctoralia) |
| `GET /api/kpis` | `routes/kpis.js` | Express | Aggregated KPI summary |
| `GET /api/reports/*` | `routes/reports.js` | Express | Cross-platform performance reports |
| `GET /api/traceability/*` | `routes/traceability.js` | Express | Attribution traceability |
| `POST/GET /api/doctoralia/*` | `routes/doctoralia.js` | Express | Doctoralia settlement ingestion |

## Execution Services

Internal background execution is handled by:

| Service | File | Purpose |
|---|---|---|
| Playbook Runner | `services/playbookRunner.js` | Durable step execution with retries + dead-letter |
| Playbook Automation | `services/playbookAutomation.js` | Webhook trigger → playbook step definitions |
| Lead Scorer | `services/leadScorer.js` | AI-powered lead scoring with `lead_scores` persistence |
| Doctoralia Service | `services/doctoralia.service.js` | Transactional ingest + reconciliation logic |

## Consequences

- Frontend must never call Supabase Edge functions for write operations — all writes go through
  Express.
- Any new integration (Google Ads, HubSpot, etc.) adds an Express route first.
- Supabase Edge functions are deprecated for business logic; kept only for Realtime/RLS reads.
- `services/playbookRunner.js` is the authoritative execution engine for all background jobs.
- Every outbound side effect (WhatsApp send, Meta API call) must go through a playbook step so it
  is idempotent, retried on failure, and recorded in `agent_run_steps`.
