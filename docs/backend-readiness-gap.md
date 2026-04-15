# Backend Readiness Gap Report

Date: 2026-04-14  
Last updated: 2026-04-15 — applied remediations marked ✅

## In-Memory Models and Fallbacks

| area | current behavior | production risk |
|---|---|---|
| auth users | ✅ auth.js now uses PostgreSQL `users` table; in-memory fallback only in dev/test | resolved for production |
| credentials | backend/src/models/credential.js falls back to memory when DB unavailable | non-critical in prod if DB enforcement is active |
| integrations | backend/src/models/integration.js falls back to memory when DB unavailable | non-critical in prod if DB enforcement is active |
| leads | backend/src/models/lead.js falls back to memory when DB unavailable | non-critical in prod if DB enforcement is active |

## Persistence Gaps
- ✅ In production (`NODE_ENV=production`) the backend now aborts startup if `DATABASE_URL` (or `SUPABASE_DATABASE_KEY`) is not set — no silent fallback.
- ✅ `env.js` validates `DATABASE_URL` presence at startup in production, before the pool module is loaded.
- ✅ `db/index.js` calls `process.exit(1)` if the connectivity check fails in production.
- The in-memory fallback in credential, integration, and lead models is now unreachable in production because the process would have already exited during startup without a valid DB.

## Credential Storage Model
- Positive:
  - AES-based encryption before storage.
  - keys never returned to frontend APIs.
- Remaining gap:
  - no documented rotation workflow in code for encrypted secrets.

## Auth Limitations
- ✅ Register/login are now DB-backed when a PostgreSQL pool is available.
- JWT revocation/session management not implemented.
- Hybrid auth (custom JWT + optional Supabase JWT verification) is valid but needs explicit environment-level policy documentation.

## Integration Limitations
- Connection testing exists, but full OAuth lifecycle/webhook ingestion is not implemented.
- Some analytics endpoints require additional metadata (for example Meta adAccountId) not enforced at connection time.

## Low-Risk Improvements Applied
- Frontend no longer implies backend features exist where they do not.
- Placeholder actions in CRM and Playbooks are explicitly marked.
- Hardcoded Meta adAccountId usage removed from dashboard page.
- ✅ Auth users durable in production (PostgreSQL `users` table).
- ✅ DB mandatory in production — startup fails rather than silently degrading.

## Remaining Blocks to Production Readiness
1. ~~Durable user store for auth path used in production.~~ ✅ Applied.
2. ~~Mandatory DB availability for critical data domains.~~ ✅ Applied (fail-fast).
3. Migration and deployment guardrails (CI pipeline step to apply migrations before traffic).
4. End-to-end execution flows for CRM actions and playbook orchestration.
5. Monitoring/alerting around integration health and data freshness.
6. Figma Phase 1 validation: obtain real `fileKey` and `nodeId` values via Figma API.
7. OAuth lifecycle / webhook ingestion for Meta, WhatsApp, Google, HubSpot.
