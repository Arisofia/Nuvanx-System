# Backend Readiness Gap Report

Date: 2026-04-15
Last updated: 2026-04-15 17:20 UTC

## In-Memory Models and Fallbacks

| area | current behavior | production risk |
|---|---|---|
| auth users | backend/src/routes/auth.js uses PostgreSQL users table when DB is available; memory fallback is dev/test only | low in production after DB enforcement; fallback remains non-prod only |
| credentials | backend/src/models/credential.js falls back to memory only when DB unavailable in non-production | low in production due fail-fast DB policy |
| integrations | backend/src/models/integration.js falls back to memory only when DB unavailable in non-production | low in production due fail-fast DB policy |
| leads | backend/src/models/lead.js falls back to memory only when DB unavailable in non-production | low in production due fail-fast DB policy |

## Persistence Gaps
- Resolved: In production, `DATABASE_URL` (or `SUPABASE_DATABASE_KEY`) is mandatory at env validation.
- Resolved: `backend/src/db/index.js` now hard-fails process startup if DB config is missing or initial connectivity check fails in production.
- Non-production environments still allow in-memory mode for local development and tests.

## Credential Storage Model
- Positive:
  - AES-based encryption before storage.
  - keys never returned to frontend APIs.
- Gap:
  - no documented rotation workflow in code for encrypted secrets.
  - fallback-to-memory mode can undermine operational guarantees.

## Auth Limitations
- Resolved: Backend auth register/login now persists users in PostgreSQL (`users` table) when DB is available.
- Non-production fallback remains in-memory to preserve local workflow and test portability.
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
1. Migration and deployment guardrails (automated migration verification in CI/CD).
2. JWT revocation/session invalidation strategy.
3. End-to-end execution flows for CRM actions and playbook orchestration.
4. Monitoring/alerting around integration health and data freshness.
