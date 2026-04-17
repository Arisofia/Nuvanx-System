# CI/CD Status

Date: 2026-04-17

## Workflows

### 1. CI (`ci.yml`)

Trigger:
- Push to `main`, `copilot/**`, `feature/**`, `fix/**`
- Pull request to `main`

Jobs:
- `backend`: Node setup → `npm ci` → `npm test` (86 tests)
- `frontend-lint`: ESLint check
- `frontend`: Node setup → `npm ci` → `npm run build`

### 2. Deploy (`deploy.yml`)

Trigger: Runs after CI passes on `main` (workflow_run)

Jobs:
- `deploy-backend`: Deploys backend to **Render** via Render deploy hook URL
- `deploy-frontend`: Deploys frontend to **Vercel** via Vercel CLI

Required GitHub secrets:
- `RENDER_DEPLOY_HOOK_URL` — Render service deploy hook (Render Dashboard → Service → Settings → Deploy Hook)
- `VERCEL_TOKEN` — Vercel personal access token (Vercel → Account Settings → Tokens)
- `VERCEL_ORG_ID` — Vercel team ID 
- `VERCEL_PROJECT_ID` — Vercel project ID (Vercel → Project → Settings → General)

## What Is Enforced

1. Backend unit tests pass before merge.
2. Frontend lint check before merge.
3. Frontend build validity before merge.
4. Automatic backend deployment to Render on successful CI.
5. Automatic frontend deployment to Vercel on successful CI.

## Required Production Environment Variables

### Backend (set in Render dashboard)
- `NODE_ENV=production`
- `PORT=10000`
- `JWT_SECRET` — minimum 32 characters
- `ENCRYPTION_KEY` — minimum 32 characters
- `DATABASE_URL` or `SUPABASE_DATABASE_KEY` — either one satisfies the production database requirement; set it to the Supabase PostgreSQL connection string
- `FRONTEND_URL` — deployed Vercel URL (e.g. `https://nuvanx.vercel.app`)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` — enables backend to accept Supabase access tokens

### Frontend (set in Vercel dashboard → Project → Settings → Environment Variables)
- `VITE_API_URL` — Render backend URL (e.g. `https://nuvanx-backend.onrender.com`)
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY`

## Not Yet Enforced

1. No automated DB migration test against a disposable database.
2. No integration test suite for external APIs with mocked network contracts.
3. No security scans (dependency audit/SAST/secrets) in workflows.
4. No staging environment — deploys directly to production.
