# Nuvanx System

Operational CRM/integrations/AI web application with an Express backend and React frontend.

## Current State

### Implemented
- Backend API server with routes for auth, credentials, integrations, leads, dashboard, AI, GitHub sync, Figma events, playbooks, and webhooks.
- Frontend application (React 19 + Vite) with routes:
  - `/dashboard` — Control center with Meta Ads KPIs, agent status, action plan, and activity feed.
  - `/playbooks` — Automation playbooks.
  - `/crm` — Lead pipeline with stages, add-lead modal, and search/filter.
  - `/live` — Live dashboard with charts.
  - `/integrations` — Integration status and configuration.
  - `/ai` — AI Layer.
- Dark theme design system: purple (`brand-*`), near-black (`dark-*`), silver (`metal-*`), Manrope font.
- Encrypted credential storage (AES-256-GCM) in backend vault.
- Figma sync via Supabase: KPIs written to `design_tokens`, `dashboard_metrics`, and `figma_sync_log` tables.
- Supabase migrations under `supabase/migrations/`.
- CI/CD: GitHub Actions CI + auto-deploy backend to Railway.

### Partial
- In-memory fallback exists for dev/test paths in several backend models.
- Integration analytics endpoints depend on additional metadata and external credentials.

### Missing
- Email transport for password reset (token generated but not sent).
- Full playbook execution backend.
- Some CRM shortcut actions (Notes) are not yet wired.

## Project Structure

- `backend/` — Express API and model/service layers.
- `frontend/` — React + Vite UI.
- `monitoring/` — Grafana Alloy observability stack.
- `supabase/` — DB schema and migrations.
- `docs/` — Architecture and CI/CD docs.
- `scripts/` — Repository utility scripts.

## Development

```bash
# Full monorepo (from root)
npm run install:all
npm run dev:backend   # nodemon
npm run dev:frontend  # Vite on http://localhost:5173
```

## Testing

```bash
npm run test:backend                                        # all tests
cd backend && npx jest tests/auth.test.js --runInBand --forceExit  # single file
```

## Key Documentation
- [SECURITY.md](SECURITY.md) — Security gaps and production readiness
- [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — Database setup (both Supabase projects)
- [docs/agents-and-integrations-architecture.md](docs/agents-and-integrations-architecture.md) — Architecture and agent roadmap
- [docs/ci-cd-status.md](docs/ci-cd-status.md) — CI/CD pipeline status
- [monitoring/README.md](monitoring/README.md) — Grafana Alloy monitoring setup
