# Production Readiness Gap

Date: 2026-04-15

> This document provides an honest, objective assessment of the delta between the current audited system state and a fully realized, commercially viable production environment. It is updated as gaps are closed.

---

## What Is Production-Capable Now

| Capability | Evidence |
|---|---|
| Core data models | `users`, `leads`, `credentials`, `integrations`, `audit_log` tables with RLS in `001_initial_schema.sql` |
| Encrypted credential storage | AES-256-GCM + PBKDF2 in `backend/src/services/encryption.js`; raw keys never returned to client |
| DB-backed authentication | `users` table with bcrypt password hashing; in-memory fallback unreachable in production |
| Production fail-fast | `env.js` validates `DATABASE_URL` at startup; `db/index.js` exits on connectivity failure |
| Backend API | Auth, leads, dashboard, integrations, credentials, AI routes operational |
| Frontend routing | 6 normalized routes: `/dashboard`, `/operativo`, `/crm`, `/live`, `/integrations`, `/ai` |
| Dashboard metrics | Revenue, leads, conversion rate, funnel wired to real API aggregations |
| CRM lead management | Full CRUD (create via modal, list, stage view) wired to `POST/GET /api/leads` |
| Integration credential vault | Connect / test / validate-all endpoints operational |
| Data truth labeling | All mock/demo/placeholder sections explicitly labeled in UI; no fabricated live metrics |
| CI pipeline | Backend tests (30), frontend build, Figma mapping validation, frontend lint enforced on every PR |
| Multi-tenant data isolation | `user_id` filter on every database query; RLS enabled on all tables |

---

## What Is Not Production-Capable

### Authentication and Sessions

| Gap | Detail | Risk |
|---|---|---|
| JWT revocation | Tokens remain valid for the `JWT_EXPIRES_IN` duration after logout | Medium — stolen tokens valid until expiry |
| Session management | No refresh token rotation; single long-lived JWT only | Medium |
| Password reset | No `/api/auth/forgot-password` or `/api/auth/reset-password` endpoint | High — users locked out permanently if password forgotten |
| Email verification | No email confirmation on registration | Medium |

### Real-time Features

| Gap | Detail | Risk |
|---|---|---|
| WebSocket / real-time streams | `/live` route polls every 30 s; no persistent connection | Low (UX impact only until scale increases) |
| Supabase Realtime integration | `user_integrations` sync uses Realtime but not wired to main dashboard | Low |
| Active user counting | Labeled placeholder; no event stream backing it | Cosmetic |

### Integrations

| Gap | Detail | Risk |
|---|---|---|
| OAuth 2.0 lifecycle | No token refresh, no consent flow, no scope management | High — tokens expire; manual reconnection required |
| Webhook inbound processing | `POST /api/integrations/:service/webhook` does not exist | High — no real-time event ingestion |
| Webhook retry / dead-letter queue | Not designed | High — data loss on webhook delivery failure |
| Meta Graph API permissions | Blocked pending business verification | External blocker |
| HubSpot production OAuth | Blocked pending developer portal approval | External blocker |

### Data Persistence

| Gap | Detail | Risk |
|---|---|---|
| DB migration pipeline | Migrations run manually; no CI gate | High — schema drift in production |
| Model-level DB fallback | Credential / integration / lead models fall back to in-memory on query failure after startup | Medium — silent data loss if DB becomes unavailable post-startup |
| `dashboard_metrics` materialized view | Dashboard aggregates on-the-fly per request; no caching | Performance risk at scale |

### AI / Agent Layer

| Gap | Detail | Risk |
|---|---|---|
| Autonomous agent execution | Zero background execution; all AI is user-initiated synchronous LLM calls | N/A (not claimed) |
| Agent job table | No persistence for AI outputs or approval queue | Blocks all agent features |
| Orchestration event bus | Not designed; no Supabase webhook listeners | Blocks all event-driven features |

### Operations

| Gap | Detail | Risk |
|---|---|---|
| Deployment automation | No deploy workflow; all releases are manual | High |
| Secret management | `.env` files injected manually; no Doppler or equivalent | High — credential exposure risk |
| Monitoring / alerting | No APM, error tracking (Sentry), or uptime monitoring | High |
| Log aggregation | `winston` logs to stdout only; no centralized log store | Medium |
| Rate limit tuning | Default `express-rate-limit` config; not load-tested | Medium |
| Load testing | No performance baseline established | Medium |

---

## External Blockers (Cannot Be Resolved Internally)

| Blocker | Required Action | Estimated Timeline |
|---|---|---|
| Meta Graph API business verification | Submit business verification docs and permission requests to Meta Developer Portal | 2–6 weeks (Meta review process) |
| HubSpot OAuth application approval | Submit app for review in HubSpot Developer Portal | 1–4 weeks |
| Meta `ads_read` + `leads_retrieval` permissions | Separate approval request after business verification | 1–3 weeks after verification |

---

## Honest Readiness Score

**72 / 100**

| Dimension | Score | Notes |
|---|---|---|
| Data persistence and integrity | 85 | DB-backed models, RLS, encrypted credentials, production fail-fast |
| Authentication | 65 | DB-backed login/register; no JWT revocation, no password reset, no MFA |
| API completeness | 70 | Core CRUD working; OAuth lifecycle, webhooks, agent endpoints missing |
| Frontend data truth | 90 | All fabricated metrics purged; mock sections explicitly labeled |
| CI/CD | 60 | Tests + lint + build enforced; no deploy automation, no migration CI |
| External integrations | 40 | Credential storage works; actual data flows blocked by external permissions |
| Real-time features | 30 | Polling only; no WebSocket, no event-driven agent triggers |
| Agent / AI layer | 25 | Synchronous LLM proxy only; full agent architecture is design-phase only |

**Point deductions (28 pts):** external API permission blockers (Meta + HubSpot), missing OAuth lifecycle, no WebSocket real-time layer, no deployment automation, no password reset, no agent execution engine.

---

## Priority Remediation Sequence

1. **Immediately:** Initiate Meta and HubSpot developer portal application review processes.
2. **Sprint 1:** Implement JWT revocation (blocklist in Redis or Supabase `revoked_tokens` table) and password reset flow.
3. **Sprint 1:** Add DB migration CI job to `validate-system.yml`.
4. **Sprint 1:** Implement Doppler (or equivalent) for secret management in all environments.
5. **Sprint 2:** Implement HubSpot OAuth 2.0 flow (once approved) — `oauth/start` + `oauth/callback` endpoints.
6. **Sprint 2:** Implement webhook listener with HMAC verification, retry logic, and dead-letter queue.
7. **Sprint 3:** Add deployment automation workflow (CreateOS or GitHub Actions + cloud provider).
8. **Sprint 3:** Design and implement agent job queue + approval gate.
9. **Sprint 4:** WebSocket implementation for `/live` route once demand justifies the complexity.
