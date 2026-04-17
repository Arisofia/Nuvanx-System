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
- `deploy-backend`: Deploys backend to **Railway** via Railway CLI

Required secrets: `RAILWAY_TOKEN`, `RAILWAY_SERVICE_ID`

## What Is Enforced

1. Backend unit tests pass before merge.
2. Frontend lint check before merge.
3. Frontend build validity before merge.
4. Automatic backend deployment to Railway on successful CI.

## Not Yet Enforced

1. No automated DB migration test against a disposable database.
2. No integration test suite for external APIs with mocked network contracts.
3. No security scans (dependency audit/SAST/secrets) in workflows.
4. No staging environment — deploys directly to production.
5. No frontend deployment pipeline (frontend is dev-only or manual hosting).
