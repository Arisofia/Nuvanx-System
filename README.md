# Nuvanx System

Operational CRM, integrations, and AI web application for revenue intelligence workflows.
Express (Node 20) backend + React (Vite) frontend.

> **Status-first policy.** This README documents actual capabilities and
> known limitations. Marketing language is not permitted here.

---

## Table of Contents

1. [Current State](#current-state)
2. [Architecture Overview](#architecture-overview)
3. [Prerequisites](#prerequisites)
4. [Environment Variables](#environment-variables)
5. [Database Setup](#database-setup)
6. [Running Locally](#running-locally)
7. [Running Tests](#running-tests)
8. [Production Deployment](#production-deployment)
9. [Known Architectural Limitations](#known-architectural-limitations)
10. [Key Documentation](#key-documentation)

---

## Current State

### Implemented
- Backend Express API with routes for `/api/auth`, `/api/leads`, `/api/dashboard`, `/api/integrations`, `/api/credentials`, and `/api/ai`.
- Frontend React application with routes:
  - `/dashboard` — executive metrics (API-backed: revenue, leads, conversion rate, integrations)
  - `/operativo` — automation playbooks (demo data; backend orchestration not implemented)
  - `/crm` — lead pipeline table with Add Lead modal (API-backed via `POST /api/leads`)
  - `/live` — operational snapshot with 30-second metric polling; hourly chart and activity feed are labeled placeholder
  - `/integrations` — credential vault connect / test / validate-all
  - `/ai` — content generation and campaign analyzer (requires configured AI credentials)
- Encrypted credential storage: AES-256-GCM with PBKDF2 key derivation (backend only, key never sent to client).
- DB-backed authentication: `users` table via PostgreSQL when `DATABASE_URL` is set; in-memory fallback for dev/test only.
- Production fail-fast: server exits at startup if `DATABASE_URL` is absent or unreachable in `NODE_ENV=production`.
- Supabase optional overlay: `AuthContext` uses Supabase Auth when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set; backend accepts Supabase JWTs when `SUPABASE_JWT_SECRET` is set.
- CI: GitHub Actions runs backend Jest tests (30) and frontend Vite build on every push/PR.
- Figma mapping validation foundation: `docs/figma-component-map.json` + `scripts/validate-figma-mapping.mjs`.

### Partial
- Integration analytics (Meta trends, HubSpot trends) depend on connected service credentials and additional metadata (e.g. `META_AD_ACCOUNT_ID`).
- Figma node-level verification is not implemented — `TODO` node IDs are treated as warnings.
- CRM row actions (WhatsApp launch, calendar scheduling, notes) are placeholder.

### Mock / Demo
- `frontend/src/pages/Playbooks.jsx` — all playbook cards, run counts, and success rates are static demo data; explicitly labeled in UI.
- `frontend/src/pages/LiveDashboard.jsx` — 24-hour lead chart and activity feed are placeholder; labeled in UI.

### Not Implemented
- Full playbook execution engine and execution history tracking.
- Webhook ingestion pipelines for Meta / WhatsApp events.
- Full OAuth lifecycle management (token refresh, scopes, consent flow).
- JWT revocation / session invalidation.

---

## Architecture Overview

```
Nuvanx-System/
├── backend/                  Express API (Node 20)
│   ├── src/
│   │   ├── config/env.js     Environment config + production validation
│   │   ├── db/               PostgreSQL pool + migrations
│   │   ├── middleware/        JWT auth (custom + Supabase)
│   │   ├── models/           leads, integrations, credentials (DB-first, mem fallback)
│   │   ├── routes/           auth, leads, dashboard, integrations, credentials, ai
│   │   └── services/         encryption, meta, hubspot, openai, gemini
│   └── tests/                Jest unit tests
├── frontend/                 React + Vite (Node 20)
│   └── src/
│       ├── components/       Layout, Sidebar, TopNav, MetricCard, FunnelChart, IntegrationCard
│       ├── context/          AuthContext (Supabase + custom JWT)
│       ├── hooks/            useApi, useIntegrations
│       ├── lib/supabase/     Supabase client singleton, integrations sync
│       └── pages/            Dashboard, CRM, LiveDashboard, Integrations, AILayer, Playbooks, Login
├── docs/                     Forensic audit, data truth matrix, Figma spec
└── scripts/                  validate-figma-mapping.mjs, supabase setup helpers
```

---

## Prerequisites

- Node.js 20 (see `.nvmrc`)
- PostgreSQL 14+ (or a Supabase project with the direct connection string)

---

## Environment Variables

### Backend (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | **Yes** | Minimum 32-character secret for signing JWTs |
| `ENCRYPTION_KEY` | **Yes** | Minimum 32-character key for AES-256-GCM credential encryption |
| `DATABASE_URL` | Required in production | PostgreSQL connection string — e.g. `postgresql://postgres:PASSWORD@db.HOST.supabase.co:5432/postgres` |
| `SUPABASE_DATABASE_KEY` | Alternative to `DATABASE_URL` | Falls back to this if `DATABASE_URL` is unset |
| `NODE_ENV` | No (default: `development`) | Set to `production` to enable fail-fast DB checks and other production guards |
| `PORT` | No (default: `3001`) | HTTP server port |
| `FRONTEND_URL` | No (default: `http://localhost:5173`) | CORS allowed origin |
| `JWT_EXPIRES_IN` | No (default: `24h`) | JWT token lifetime |
| `SUPABASE_URL` | No | Supabase project URL (enables Supabase Admin SDK features) |
| `SUPABASE_ANON_KEY` | No | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase service role key (server-side only) |
| `SUPABASE_JWT_SECRET` | No | Enables backend to accept Supabase-issued access tokens as Bearer JWTs |
| `OPENAI_API_KEY` | No | Server-level OpenAI key; per-user vault credential takes priority |
| `GEMINI_API_KEY` | No | Server-level Google Gemini key |
| `GOOGLE_API_KEY` | No | Google API key for Calendar / Gmail |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `HUBSPOT_ACCESS_TOKEN` | No | HubSpot Private App token (recommended over `HUBSPOT_API_KEY`) |
| `HUBSPOT_PORTAL_ID` | No | HubSpot portal ID |
| `META_ACCESS_TOKEN` | No | Meta long-lived system user token |
| `META_AD_ACCOUNT_ID` | No | Meta ad account ID in `act_XXXXXXXXX` format — required for `/api/dashboard/meta-trends` |
| `WHATSAPP_ACCESS_TOKEN` | No | WhatsApp Business Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | No | WhatsApp phone number ID (numeric) |

> **Never commit real values.** All `.env`, `.env.local`, and `.env.*.local` files are excluded by `.gitignore`.

### Frontend (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | No (default: `http://localhost:3001`) | Backend API base URL |
| `VITE_SUPABASE_URL` | No | Supabase project URL — enables Supabase Auth path |
| `VITE_SUPABASE_ANON_KEY` | No | Supabase anon key — enables Supabase Auth path |
| `VITE_SUPABASE_FIGMA_URL` | No | Supabase Figma V.1 project URL (if separate) |
| `VITE_SUPABASE_FIGMA_ANON_KEY` | No | Supabase Figma V.1 anon key |

When `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, the frontend uses Supabase Auth (`signInWithPassword`). Otherwise it falls back to the custom backend JWT auth path.

---

## Database Setup

### 1. Run the initial migration

Connect to your PostgreSQL instance and execute the migration:

```bash
psql "$DATABASE_URL" -f backend/src/db/migrations/001_initial_schema.sql
```

Or via Supabase SQL editor: paste the contents of `backend/src/db/migrations/001_initial_schema.sql` and run.

### Tables created

| Table | Purpose |
|---|---|
| `users` | Application user accounts (email + bcrypt password hash) |
| `credentials` | AES-256-GCM encrypted API keys per user per service |
| `integrations` | Connection state per user per service (status, last_sync, metadata JSONB) |
| `leads` | CRM lead records (name, email, phone, source, stage, revenue, notes) |
| `audit_log` | Append-only record of sensitive operations |

### Row Level Security

RLS is enabled on all tables. The backend uses a shared service-role connection and enforces user isolation via `WHERE user_id = $1` in every query. Tighten the permissive policies if you switch to row-level JWT propagation via `auth.uid()`.

### 2. Optional — Supabase-managed tables

If using Supabase Auth, also run `frontend/src/lib/supabase/database.sql` from the Supabase SQL editor to create the `user_integrations` and `user_credentials` tables used for the client-side integration sync.

---

## Running Locally

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in JWT_SECRET and ENCRYPTION_KEY at minimum
npm run dev            # nodemon, restarts on change
```

The API will be available at `http://localhost:3001`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # set VITE_API_URL if backend is not on :3001
npm run dev            # Vite dev server
```

The UI will be available at `http://localhost:5173`.

---

## Running Tests

```bash
# Backend Jest tests (30 tests)
cd backend
npm test

# Frontend Vite build verification
cd frontend
npm run build

# Figma mapping validation
node scripts/validate-figma-mapping.mjs
# or: cd frontend && npm run validate:figma
```

---

## Production Deployment

1. Set `NODE_ENV=production` in the backend runtime environment.
2. Set `DATABASE_URL` to a live PostgreSQL connection string (or `SUPABASE_DATABASE_KEY`).
3. Set `JWT_SECRET` (≥ 32 chars) and `ENCRYPTION_KEY` (≥ 32 chars).
4. Run `backend/src/db/migrations/001_initial_schema.sql` against the production database before first startup.
5. Build the frontend: `cd frontend && npm run build` — serve `dist/` via a static host or CDN.
6. Set `FRONTEND_URL` on the backend to match the production frontend origin (CORS).
7. The backend will exit at startup (`process.exit(1)`) if `DATABASE_URL` is absent or the database is unreachable — this is intentional and prevents serving requests without persistence.

---

## Known Architectural Limitations

| Area | Limitation |
|---|---|
| Auth session management | JWT revocation is not implemented. Tokens remain valid for `JWT_EXPIRES_IN` even after logout. |
| Auth persistence (backend-native) | In `NODE_ENV=development` without `DATABASE_URL`, users are stored in-memory and lost on restart. Set `DATABASE_URL` to persist users in development. |
| Playbook execution | The `/operativo` route displays demo playbook cards only. No backend execution engine, scheduler, or history tracking exists. |
| Real-time event stream | `LiveDashboard` polls `/api/dashboard/metrics` every 30 seconds. The 24-hour lead chart is zero-filled placeholder pending an hourly time-series endpoint. |
| Meta ad trends | Requires `adAccountId` stored in integration metadata. Without it, the meta-trends section on the dashboard is hidden. |
| Figma node validation | The Figma mapping validator checks JSON schema and file paths only; it does not call the Figma API to verify node IDs. |
| OAuth lifecycle | Integration connections accept a manually provided API token only. Token refresh and OAuth consent flows are not implemented. |
| Webhook ingestion | There is no inbound webhook handler for Meta lead form events or WhatsApp messages. |
| CRM row actions | WhatsApp launch, calendar scheduling, and notes from the CRM table are labeled as placeholders and have no backend implementation. |

---

## Key Documentation

| File | Description |
|---|---|
| `docs/repo-forensic-audit.md` | Full architectural classification (implemented / partial / mock / missing) |
| `docs/data-truth-matrix.md` | Map of every frontend data source to its verified backend origin |
| `docs/figma-component-map.json` | Figma node → React component mapping |
| `docs/figma-validation-spec.md` | Figma validation tool specification |
| `docs/backend-readiness-gap.md` | Gap analysis for production backend readiness |
| `SUPABASE_SETUP.md` | Supabase project setup guide |

