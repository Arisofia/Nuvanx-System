# Nuvanx System

Operational CRM/integrations/AI web application with an Express backend and React frontend.

This README is intentionally status-first and non-marketing.

## Current State

### Implemented
- Backend API server with routes for auth, credentials, integrations, leads, dashboard, AI, GitHub sync, Figma events, playbooks, and webhooks.
- Frontend application (React 19 + Vite) with routes:
  - `/dashboard` — Live control center with Meta Ads KPIs, agent status, adaptive action plan, and activity feed (auto-refresh 60 s).
  - `/operativo` — Playbooks (alias `/playbooks` redirects here).
  - `/crm` — Lead pipeline with stages, add-lead modal, and search/filter.
  - `/live` — Live dashboard with charts.
  - `/integrations` — Integration status and configuration.
  - `/ai` — AI Layer.
- Dark theme design system: purple (`brand-*`), near-black (`dark-*`), silver (`metal-*`), Manrope font.
- Encrypted credential storage in backend models/services.
- Three-layer metrics normalisation: `figmaClient.js` → `useDashboardMetrics.js` → `normalizeDashboardMetrics.js`.
- Figma mapping validation foundation:
  - `docs/figma-component-map.json`
  - `scripts/validate-figma-mapping.mjs`
  - CI workflow checks.
- Grafana Alloy monitoring stack (`monitoring/`).
- Supabase migrations under `supabase/migrations/`.

### Partial
- In-memory fallback still exists for non-production development/testing paths in several backend models.
- Integration analytics endpoints depend on additional metadata and external credentials.

### Production Guardrails
- In production, backend startup requires a valid DB connection string and exits fast when PostgreSQL is unavailable.
- Backend-native auth persists users in PostgreSQL in production-capable paths.
- All env config centralised in `backend/src/config/env.js` — `process.env` is never read directly in routes or services.
- Two separate Supabase clients (`supabaseAdmin` for nuvanx-prod, `supabaseFigmaAdmin` for the Figma project) — never mixed.

### Mock / Demo
- `frontend/src/pages/Playbooks.jsx` content is demo data and explicitly labelled in UI.
- `frontend/src/pages/LiveDashboard.jsx` chart/feed sections are placeholder/mock and explicitly labelled.
- Some CRM shortcut actions (WhatsApp, Calendar, Notes) are placeholder actions in UI.

### Missing
- Full Figma node-level verification against Figma API.
- Durable user/auth storage path for backend-native auth in production.
- Full playbook execution backend and execution tracking.

## Project Structure

- `backend/` — Express API and model/service layers.
- `frontend/` — React + Vite UI.
- `monitoring/` — Grafana Alloy observability stack.
- `supabase/` — DB schema and migrations.
- `docs/` — Readiness, truth matrix, Figma validation docs.
- `scripts/` — Repository utility scripts.

## Development

### Backend
```bash
cd backend
npm install
# configure .env from .env.example
npm run dev
```

### Frontend
```bash
cd frontend
npm install
# configure .env from .env.example
npm run dev
```

### Full Monorepo (from root)
```bash
npm run install:all
npm run dev:backend   # nodemon
npm run dev:frontend  # Vite on http://localhost:5173
```

## Testing

```bash
npm run test:backend                                        # all tests
cd backend && npx jest tests/auth.test.js --runInBand --forceExit  # single file
```

## Validation

### Figma Mapping Validation
From repository root:
```bash
node scripts/validate-figma-mapping.mjs
```

From frontend folder:
```bash
npm run validate:figma
```

The validator checks route/file mapping structure. It does not yet validate node IDs against Figma API.

## Key Documentation
- [docs/repo-forensic-audit.md](docs/repo-forensic-audit.md)
- [docs/data-truth-matrix.md](docs/data-truth-matrix.md)
- [docs/figma-validation-audit.md](docs/figma-validation-audit.md)
- [docs/figma-validation-spec.md](docs/figma-validation-spec.md)
- [docs/backend-readiness-gap.md](docs/backend-readiness-gap.md)
- [docs/agents-and-integrations-architecture.md](docs/agents-and-integrations-architecture.md)
- [docs/ci-cd-status.md](docs/ci-cd-status.md)
- [docs/production-readiness-gap.md](docs/production-readiness-gap.md)
- [docs/final-execution-report.md](docs/final-execution-report.md)
- [docs/final-cleanup-and-readiness-report.md](docs/final-cleanup-and-readiness-report.md)
