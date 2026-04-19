# Forensic Remediation Report — 2026-04-19

## Scope + Constraints

This pass is a **zero-trust local repository and CI/CD hardening remediation**. Runtime provider state (Vercel/Supabase/GitHub secrets dashboards, live connector credentials, production logs) cannot be mutated from this environment without external authenticated connectors.

## Phase 1 — Inventory Classification (path-level)

### A. ACTIVE PRODUCTION
- `frontend/src/**` (Vite SPA runtime UI)
- `supabase/functions/api/index.ts` (canonical API runtime)
- `supabase/migrations/*.sql` (DB schema/RLS evolution)
- `vercel.json` and `frontend/vercel.json` (rewrite /api to Supabase Edge Function)
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` (build/deploy pipeline)

### B. LEGACY / MIXED-RUNTIME COMPATIBILITY
- `backend/src/**` (legacy Node API kept for local/dev tests and fallback)
- `backend/tests/**` (backend regression suite)
- `backend/Procfile`, `backend/railway.json` (legacy deployment artifacts)

### C. DUPLICATE / OVERLAPPING CONFIG
- Root `vercel.json` and `frontend/vercel.json` both define similar rewrites/headers.
- Dual API implementations exist (`backend/src/server.js` and `supabase/functions/api/index.ts`).

### D. BROKEN / MISCONFIGURED (remediated in this pass)
- `.github/workflows/ci.yml` had hardcoded concrete Supabase URL + anon key value in frontend build env.
- `.github/workflows/deploy.yml` used `continue-on-error: true` for production deployment step, allowing silent deploy failure.

### E. SECURITY RISK (remediated in this pass)
- Hardcoded real-looking Supabase anon credential material in repository workflow config.

### F. TEST-ONLY
- `backend/tests/**`
- `scripts/debug-runs.js`, `scripts/verify-reality.js`, `scripts/db-audit.js`

### G. DOCUMENTATION DRIFT RISK
- `SYSTEM_VALIDATION_REPORT.md`, `PRODUCTION_READINESS_CERTIFICATION.md`, and `VERIFICATION_COMPLETION_LOG.md` must be treated as snapshots requiring live re-validation before relying on current production status.

## Phase 2 — Architecture Truth Map (canonical)

**Canonical production chain:**

Browser (React/Vite on Vercel)
→ Vercel rewrite `/api/*`
→ Supabase Edge Function `functions/v1/api`
→ Supabase Auth token validation (`auth.getUser`)
→ Supabase Postgres (RLS-protected `public` tables)
→ external connectors (Meta/OpenAI/Gemini/Google Ads/WhatsApp) via server-side secrets + encrypted credentials.

## Phase 3 — Secret + Env Cleanup Executed

### Changes made
1. Replaced hardcoded frontend CI build Supabase values with neutral CI placeholders:
   - `VITE_SUPABASE_URL: https://example.supabase.co`
   - `VITE_SUPABASE_ANON_KEY: ci-anon-key-placeholder`
2. Kept deployment-time production secrets sourced from GitHub secrets in deploy workflow.

### Why
- Prevent repository from embedding environment-specific credential material.
- Preserve deterministic CI builds without coupling to production values.

## Phase 11 — CI/CD Cleanup Executed

- Removed `continue-on-error: true` from the Vercel production deploy step so deployment failures now fail the job, preventing false-green production pipeline states.

## Validation Commands Run

- `npm --prefix frontend run lint`
- `npm --prefix frontend run build`
- `npm --prefix backend run test`

## Remaining External Blockers (requires authenticated provider access)

- Cannot directly inspect or mutate live Vercel project settings/secrets/deployment state.
- Cannot inspect Supabase hosted secrets (`supabase secrets list`) or live connector runtime responses.
- Cannot verify live production URL health from provider dashboard context.

These require authenticated connector sessions/tokens not available in this execution environment.
