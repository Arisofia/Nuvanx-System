# Production Validation Checklist

This document captures the exact runtime environment variables and live endpoint checks required to verify production readiness for Nuvanx.

## 1. Vercel frontend environment

Ensure these variables are set in the Vercel frontend project settings:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL` / `VITE_API_URL` (optional; leave empty to use `/api/*` rewrite)
- `VITE_SENTRY_DSN` (optional)
- `VITE_SUPABASE_FIGMA_URL` / `VITE_SUPABASE_FIGMA_ANON_KEY` (only if Figma syncing is required)
- `FRONTEND_URL` should be set to your production front-end domain, not `*`.
- Verify the frontend deploy uses Vercel envs via `npx vercel env ls production` or `npx vercel env pull .env.local --environment production`.

## 2. Supabase Edge Function secrets

Confirm these secrets are configured for the Supabase functions project:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `META_APP_SECRET`
- `FRONTEND_URL` should be set to your production front-end domain, not `*`
- `credentials` table access is server-side only in the Edge Function, so no authenticated client-side SELECT policy is expected for that table in this architecture.
- `META_WEBHOOK_VERIFY_TOKEN` or `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID` (must match the account reachable by `META_ACCESS_TOKEN`, for example `act_4172099716404860`)
- `META_CAPI_VERSION`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `GOOGLE_ADS_SERVICE_ACCOUNT`
- `DATABASE_URL`
- `CLINIC_ID`
- `REPORT_USER_ID`
- `DOCTORALIA_SHEET_ID`
- `ENCRYPTION_KEY`
- `ACTION_SOURCE`
- `DEFAULT_PHONE_COUNTRY_CODE`
- `ENCRYPTION_KEY` is runtime-validated by `GET /api/health/secrets`; production must expose `encryptionKey.valid: true`.

## 3. GitHub Actions / CI secrets

Confirm these repository secrets exist for GitHub Actions:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY`
- `GOOGLE_ADS_SERVICE_ACCOUNT`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- `DATABASE_URL`
- `CLINIC_ID`
- `REPORT_USER_ID`

## 4. Live endpoint verification

Run these checks against the deployed frontend/backend:

1. `GET /api/health` returns `{"success":true,"status":"ok"}`
2. `GET /api/health/secrets` returns a truthy presence map for required secrets, including `ENCRYPTION_KEY`, and `encryptionKey.valid` is `true`
3. `GET /api/production/audit` returns counts for `agent_outputs`, `meta_cache`, `leads`, `public.users`, `auth.users`, and Meta integration identifiers
4. `GET /api/production/audit` reports any `public.users` / `auth.users` mismatch so orphaned profiles can be fixed
5. `GET /api/production/audit` reports Doctoralia normalization health: `doctoralia_patients`, `doctors`, `treatment_types` counts and settlement quality warnings.
6. `GET /api/webhooks/meta` responds correctly to Meta subscription challenge
7. AI routes succeed when either user vault credentials exist or env vars are present
8. `POST /api/ai/generate` returns a valid AI response when `ENCRYPTION_KEY` is configured in the functions environment
9. `/api/doctoralia/ingest` accepts Doctoralia rows and returns inserted/updated counts
10. Run a full production persistence flow and confirm one or more rows are created/updated in the database (Doctoralia leads, integrations, or audit records).
11. `GET /api/production/audit` reports settlement anomalies: future `settled_at` or `intake_at` dates and missing `patient_name` values.
12. Authenticated user has `clinic_id` for Doctoralia ingestion

## 5. Likely production failure points

The following are the most common runtime causes of failure in production:

- Missing or incorrect `VITE_SUPABASE_*` variables in Vercel
- Missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in Supabase functions
- Incorrect `META_WEBHOOK_VERIFY_TOKEN` / `META_APP_SECRET`
- Missing `OPENAI_API_KEY` / `GEMINI_API_KEY` when no user AI credential is configured
- Doctoralia ingest failing because the user has no `clinic_id`

## 6. Notes

- The frontend uses Vercel rewrites to proxy `/api/*` to Supabase functions by default.
- AI fallback behavior in functions allows server-level env keys when no user vault credential is present.
- The Supabase function is deployed with `--no-verify-jwt`; all non-public API routes are protected by manual JWT validation inside `supabase/functions/api/index.ts`.
- The current Edge Function version is `v42`; this repo's audit_log changes are tracked under Supabase lint migration 0012 and are not tied to a legacy `v32` audit schema.
- Messaging conversation tracking via Meta conversion event `messaging_conversation_started` is not implemented in this codebase. It requires explicit Conversions API support, not Graph Ads insights.
- The current routing model centralizes JWT validation in `supabase/functions/api/index.ts`, so dashboard, leads, reports, financials, and other API endpoints do not need separate per-route JWT middleware.
- Doctoralia ingestion is supported via backend authenticated API and expects clinic-linked users.
