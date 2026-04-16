# CI/CD Status

Date: 2026-04-15

## What Exists Now

Two GitHub Actions workflows are present:

1. `.github/workflows/ci.yml`
2. `.github/workflows/validate-figma-mapping.yml`

### Workflow: CI (`ci.yml`)

Trigger:
- Push to `main`, `copilot/**`, `feature/**`, `fix/**`
- Pull request to `main`

Jobs:
- `backend`:
  - Node setup from `.nvmrc`
  - `npm ci` in `backend/`
  - `npm test` with CI env secrets for JWT/encryption
- `frontend`:
  - Node setup from `.nvmrc`
  - `npm ci` in `frontend/`
  - `npm run build`
- `figma-validation`:
  - Runs `node scripts/validate-figma-mapping.mjs`

### Workflow: Validate Figma Mapping (`validate-figma-mapping.yml`)

Trigger:
- Push to `main`, `copilot/**`, `feature/**`, `fix/**`
- Pull request to `main`

Behavior:
- Runs strict Figma mapping validation via `node scripts/validate-figma-mapping.mjs`
- Fails pipeline when mapping contracts are broken

## What Is Enforced Today

1. Backend unit tests pass before merge.
2. Frontend build validity before merge.
3. Figma mapping contract checks before merge.

## What Is Not Yet Enforced

1. No automated DB migration test against a disposable/staging database.
2. No integration test suite for external APIs (Meta/Google) with mocked network contracts.
3. No deployment pipeline (build artifact -> deploy -> smoke test) in this repo.
4. No required security scans (dependency audit/SAST/secrets) configured in workflows.

## Minimum Next Additions (Priority)

1. Add migration verification job:
   - boot ephemeral Postgres
   - run SQL migrations
   - run smoke query checks
2. Add API contract tests for critical endpoints (`/api/auth/*`, `/api/dashboard/*`, `/api/integrations/*`).
3. Add security checks (`npm audit --production`, secret scan, lint gates).
4. Add deployment-stage workflow (staging first, then production promotion).

## Operational Note

Current CI is healthy as a baseline quality gate, but it is still a validation pipeline, not a full deployment automation chain.
