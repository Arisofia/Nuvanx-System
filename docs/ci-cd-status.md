# CI/CD Status

Date: 2026-04-17

## Platforms

| Layer    | Platform | Trigger                     |
|----------|----------|-----------------------------|
| Backend  | **Render** (free tier) | Deploy hook after CI passes |
| Frontend | **Vercel**             | Vercel CLI after CI passes  |
| Database | **Supabase** (free tier) | Manual migrations           |

## Workflows

### 1. CI (`ci.yml`)

Trigger:
- Push to `main`, `copilot/**`, `feature/**`, `fix/**`
- Pull request to `main`

Jobs:
- `backend`: Node setup → `npm ci` → `npm test`
- `frontend-lint`: ESLint check
- `frontend`: Node setup → `npm ci` → `npm run build`

### 2. Deploy (`deploy.yml`)

Trigger: Runs after CI passes on `main` (`workflow_run` with `conclusion == 'success'`)

Jobs:
- `deploy-backend`: Triggers **Render** deploy via deploy hook URL
- `deploy-frontend`: Deploys frontend to **Vercel** via Vercel CLI (`vercel deploy --prod`)

### Required GitHub Secrets

| Secret                 | Used by          | Description                                      |
|------------------------|------------------|--------------------------------------------------|
| `RENDER_DEPLOY_HOOK_URL` | `deploy-backend` | Render deploy hook URL (Dashboard → Service → Settings → Deploy Hook) |
| `VERCEL_TOKEN`         | `deploy-frontend` | Vercel personal access token                     |
| `VERCEL_ORG_ID`        | `deploy-frontend` | Vercel team/org ID                               |
| `VERCEL_PROJECT_ID`    | `deploy-frontend` | Vercel project ID (from `.vercel/project.json`)  |

### Required Production Environment Variables

**Render backend:**

| Variable                     | Description                          |
|------------------------------|--------------------------------------|
| `NODE_ENV`                   | `production`                         |
| `PORT`                       | Port (Render sets automatically)     |
| `JWT_SECRET`                 | JWT signing secret (≥32 chars)       |
| `ENCRYPTION_KEY`             | AES encryption key (≥32 chars)       |
| `SUPABASE_URL`               | Supabase project URL (nuvanx-prod)   |
| `SUPABASE_ANON_KEY`          | Supabase anon key                    |
| `SUPABASE_SERVICE_ROLE_KEY`  | Supabase service-role key            |
| `SUPABASE_FIGMA_URL`         | Supabase Figma project URL           |
| `SUPABASE_FIGMA_ANON_KEY`    | Supabase Figma anon key              |
| `SUPABASE_FIGMA_SERVICE_ROLE`| Supabase Figma service-role key      |
| `DATABASE_URL`               | Pooler connection string             |

**Vercel frontend (environment variables in Vercel dashboard):**

| Variable                     | Description                          |
|------------------------------|--------------------------------------|
| `VITE_API_URL`               | Backend API base URL (Render URL)    |
| `VITE_SUPABASE_URL`          | Supabase project URL                 |
| `VITE_SUPABASE_ANON_KEY`     | Supabase anon key (public)           |

## What Is Enforced

1. Backend unit tests pass before merge.
2. Frontend lint check before merge.
3. Frontend build validity before merge.
4. Automatic backend deployment to Render on successful CI.
5. Automatic frontend deployment to Vercel on successful CI.

## Not Yet Enforced

1. No automated DB migration test against a disposable database.
2. No integration test suite for external APIs with mocked network contracts.
3. No security scans (dependency audit/SAST/secrets) in workflows.
4. No staging environment — deploys directly to production.
