# Backend Readiness Gap Report

Date: 2026-04-14

## In-Memory Models and Fallbacks

| area | current behavior | production risk |
|---|---|---|
| auth users | backend/src/routes/auth.js stores users in an in-memory Map | user accounts disappear on process restart |
| credentials | backend/src/models/credential.js falls back to memory when DB unavailable | credential metadata can disappear after restart |
| integrations | backend/src/models/integration.js falls back to memory when DB unavailable | integration states may reset unexpectedly |
| leads | backend/src/models/lead.js falls back to memory when DB unavailable | lead history and revenue metrics can be lost |

## Persistence Gaps
- DATABASE_URL is optional; backend can run without durable persistence.
- db startup check in backend/src/db/index.js can nullify pool and silently shift to memory.
- This is useful for local dev/tests but unsafe as a production default.

## Credential Storage Model
- Positive:
  - AES-based encryption before storage.
  - keys never returned to frontend APIs.
- Gap:
  - no documented rotation workflow in code for encrypted secrets.
  - fallback-to-memory mode can undermine operational guarantees.

## Auth Limitations
- Backend auth register/login path is non-durable unless replaced by external auth.
- JWT revocation/session management not implemented.
- Hybrid auth (custom JWT + optional Supabase JWT verification) can be valid but needs explicit environment-level policy documentation.

## Integration Limitations
- Connection testing exists, but full OAuth lifecycle/webhook ingestion is not implemented.
- Some analytics endpoints require additional metadata (for example Meta adAccountId) not enforced at connection time.

## Low-Risk Improvements Applied in This Pass
- Frontend no longer implies backend features exist where they do not.
- Placeholder actions in CRM and Playbooks are explicitly marked.
- Hardcoded Meta adAccountId usage removed from dashboard page.

## Blocks to Production Readiness
1. Durable user store for auth path used in production.
2. Mandatory DB availability for critical data domains.
3. Migration and deployment guardrails.
4. End-to-end execution flows for CRM actions and playbook orchestration.
5. Monitoring/alerting around integration health and data freshness.
