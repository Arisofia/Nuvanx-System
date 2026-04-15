# CI/CD Status

Date: 2026-04-15

> **Honesty mandate.** This document tracks what is actually enforced by CI, what is partially covered, and what remains missing. No pipeline capability is overstated.

---

## What CI Currently Enforces

Triggered on: all pushes to `main`, `copilot/**`, `feature/**`, `fix/**` and all PRs targeting `main`.

### `.github/workflows/ci.yml`

| Job | Steps | Status |
|---|---|---|
| `backend` | `npm ci` → `npm test` (30 Jest tests) | ✅ Implemented |
| `frontend` | `npm ci` → `npm run build` (Vite production build) | ✅ Implemented |
| `figma-validation` | `node scripts/validate-figma-mapping.mjs` (strict mode) | ✅ Implemented |

### `.github/workflows/validate-system.yml`

End-to-end structural validation pipeline. Triggered on all PRs targeting `main` or `develop`, plus pushes to `main`, `copilot/**`, `feature/**`, `fix/**`.

| Job | Steps | Status |
|---|---|---|
| `backend-tests` | `npm ci` → `npm test` with required env vars | ✅ Implemented |
| `frontend-lint` | `npm ci` → `npm run lint` (ESLint — enforces react-hooks, react-refresh, no-unused-vars) | ✅ Implemented |
| `frontend-build` | `npm ci` → `npm run build` | ✅ Implemented |
| `figma-validation` | `npm ci` → `npm run validate:figma` (blocks PR if component map diverges from source) | ✅ Implemented |

### `.github/workflows/validate-figma-mapping.yml`

Strict Figma mapping validation on all PRs to `main`. Fails the PR if any route or component file mapping is invalid.

| Step | Status |
|---|---|
| Figma mapping JSON schema validation | ✅ Implemented |
| Route-to-file path existence check | ✅ Implemented |
| Figma node ID validation against Figma API | ❌ Not implemented — node IDs are `TODO` placeholders; treated as warnings only |

---

## What CI Does NOT Enforce

| Gap | Risk | Priority |
|---|---|---|
| Database migration integration tests against a staging/shadow Supabase database | Schema drift can reach production undetected | **High** |
| Automated DB schema migration run on deploy | Migrations must be run manually before server restart | **High** |
| End-to-end browser tests (Playwright / Cypress) | UI regression coverage is zero | **Medium** |
| Backend ESLint / static analysis | Node.js code style not enforced in CI | **Medium** |
| Docker build verification | No guarantee the production container image builds | **Medium** |
| Deployment automation (staging → production promotion) | Deployments are entirely manual | **High** |
| Secret scanning | Credentials accidentally committed are not caught | **High** |
| Dependency vulnerability scanning | Outdated packages with CVEs are not blocked | **Medium** |

---

## Deployment Automation Gap

The system currently has **no automated deployment pipeline**. Merging to `main` does not trigger any deployment. Manual steps required for every release:

1. `ssh` to server or open hosting dashboard.
2. `git pull origin main`.
3. `cd backend && npm ci --omit=dev`.
4. Run new migrations: `psql "$DATABASE_URL" -f backend/src/db/migrations/001_initial_schema.sql`.
5. Restart server process (PM2, systemd, or container restart).
6. `cd frontend && npm ci && npm run build` → upload `dist/` to CDN or static host.

**Designated future solution:** [CreateOS by NodeOps](https://nodeops.dev/) — automates Supabase-powered app deployment, handles custom domains, SSL provisioning, and environment management without manual `.env` file handling.

---

## Critical Path Items for CI Completeness

1. **Add DB migration job** to `validate-system.yml`:
   - Spin up a Supabase local dev instance (or shadow project).
   - Run `001_initial_schema.sql` against it.
   - Verify all backend tests still pass.

2. **Add secret scanning** to `ci.yml` (e.g., `trufflesecurity/trufflehog-actions-scan`).

3. **Add backend ESLint** — create `backend/.eslintrc.json` with `eslint-plugin-node` and add a lint step to `validate-system.yml`.

4. **Add Dependabot config** (`.github/dependabot.yml`) for `npm` in both `frontend/` and `backend/` to auto-open PRs for security updates.

5. **Add deployment workflow** triggered on push to `main` using CreateOS or equivalent.
