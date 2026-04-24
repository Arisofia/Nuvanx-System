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

## 2. Supabase Edge Function secrets

Confirm these secrets are configured for the Supabase functions project:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN` or `META_VERIFY_TOKEN`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
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
2. `GET /api/webhooks/meta` responds correctly to Meta subscription challenge
3. AI routes succeed when either user vault credentials exist or env vars are present
4. `/api/doctoralia/ingest` accepts Doctoralia rows and returns inserted/updated counts
5. Authenticated user has `clinic_id` for Doctoralia ingestion

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
- Doctoralia ingestion is supported via backend authenticated API and expects clinic-linked users.
