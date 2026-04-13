# Repository Forensic Audit

**Repository:** Arisofia/Nuvanx-System
**Branch:** copilot/full-repo-harden-design-code-align
**Audit Date:** 2026-04-13
**Auditor:** Senior Staff Engineer (automated agent)

> **CRITICAL NOTE:** This audit verifies findings against actual repository contents. Claims from prior agent summaries are treated as hypotheses until confirmed against the file tree.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Frontend Routes](#2-frontend-routes)
3. [Reusable Components](#3-reusable-components)
4. [Backend Services](#4-backend-services)
5. [Integration-Related Files](#5-integration-related-files)
6. [Authentication Model](#6-authentication-model)
7. [Persistence Model](#7-persistence-model)
8. [Figma-Related Evidence](#8-figma-related-evidence)
9. [CI/CD Presence](#9-cicd-presence)
10. [Deployment Config](#10-deployment-config)
11. [Dead / Duplicate / Inconsistencies](#11-dead--duplicate--inconsistencies)
12. [Status Matrix](#12-status-matrix)

---

## 1. Project Structure

**Verified from file tree:**

```
Nuvanx-System/
├── .github/
│   └── workflows/
│       ├── ci.yml               # Backend tests + frontend build + Figma warn-only
│       └── validate-figma-mapping.yml  # Strict Figma validation
├── .nvmrc                       # Node 20
├── .gitignore                   # Root + .zencoder/.zenflow exclusions
├── README.md                    # Project overview (partially accurate — see §11)
├── SECURITY.md                  # Security policy
├── SUPABASE_SETUP.md            # Supabase integration guide
├── package.json                 # Root workspace commands (no dependencies)
├── docs/
│   ├── FIGMA_SETUP.md           # Figma validation quick-start guide
│   ├── figma-component-map.json # Component → Figma node mapping (placeholders)
│   ├── figma-validation-audit.md
│   ├── figma-validation-spec.md
│   ├── repo-forensic-audit.md   # This file
│   ├── design-system-rules.md   # (added this pass)
│   ├── agents-and-integrations-architecture.md  # (added this pass)
│   ├── backend-readiness-gap.md # (added this pass)
│   └── final-cleanup-and-figma-readiness-report.md  # (added this pass)
├── scripts/
│   └── validate-figma-mapping.js  # Figma validation CLI tool
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── server.js
│   │   ├── config/
│   │   │   ├── database.js      # PostgreSQL pool (legacy, superseded by db/index.js)
│   │   │   └── env.js           # Environment variable config + validation
│   │   ├── db/
│   │   │   ├── index.js         # PostgreSQL pool with in-memory fallback flag
│   │   │   └── migrations/
│   │   │       └── 001_initial_schema.sql
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT Bearer authentication (custom + Supabase)
│   │   │   ├── errorHandler.js  # Global error handler
│   │   │   └── rateLimiter.js   # Tiered rate limiting
│   │   ├── models/
│   │   │   ├── credential.js    # Encrypted credential vault (DB + in-memory)
│   │   │   ├── integration.js   # Integration status tracking (DB + in-memory)
│   │   │   └── lead.js          # CRM lead management (DB + in-memory)
│   │   ├── routes/
│   │   │   ├── ai.js            # AI generation + campaign analysis
│   │   │   ├── auth.js          # Login/register (in-memory user store!)
│   │   │   ├── credentials.js   # Credential vault CRUD
│   │   │   ├── dashboard.js     # Metrics + funnel + revenue trend + integrations trends
│   │   │   ├── integrations.js  # Integration connect/test/status
│   │   │   └── leads.js         # CRM lead pipeline
│   │   ├── services/
│   │   │   ├── encryption.js    # AES-256-GCM + PBKDF2
│   │   │   ├── gemini.js        # Google Gemini API proxy
│   │   │   ├── google.js        # Google Calendar + Gmail OAuth
│   │   │   ├── hubspot.js       # HubSpot CRM API
│   │   │   ├── meta.js          # Meta Marketing API
│   │   │   ├── openai.js        # OpenAI GPT-4 proxy
│   │   │   └── whatsapp.js      # WhatsApp Business Cloud API
│   │   └── utils/
│   │       ├── logger.js        # Winston structured logging
│   │       └── validators.js    # express-validator rules
│   └── tests/
│       ├── auth.test.js         # JWT auth middleware tests
│       ├── credentials.test.js  # Credential vault tests
│       ├── encryption.test.js   # AES-256 encrypt/decrypt tests
│       └── integrations.test.js # Integration route tests
└── frontend/
    ├── .env.example
    ├── eslint.config.js
    ├── index.html
    ├── package.json
    ├── postcss.config.js
    ├── tailwind.config.js
    ├── vite.config.js
    ├── public/
    │   └── favicon.svg
    └── src/
        ├── App.jsx              # BrowserRouter + routes + AuthProvider
        ├── index.css            # Global CSS (Tailwind base)
        ├── main.jsx             # React DOM entry
        ├── assets/
        │   └── hero.png
        ├── components/
        │   ├── FunnelChart.jsx
        │   ├── IntegrationCard.jsx
        │   ├── Layout.jsx
        │   ├── MetricCard.jsx
        │   ├── Sidebar.jsx
        │   └── TopNav.jsx
        ├── config/
        │   └── api.js           # Axios instance + JWT interceptors
        ├── context/
        │   └── AuthContext.jsx  # Supabase-first auth + custom JWT fallback
        ├── hooks/
        │   ├── useApi.js        # Generic API hook (loading, error, post/get)
        │   └── useIntegrations.js  # Supabase real-time integration state
        ├── lib/
        │   └── supabase/
        │       ├── client.js    # Supabase singleton (graceful no-op if unconfigured)
        │       ├── database.sql # Schema for user_integrations + user_credentials
        │       └── integrations.js  # Supabase CRUD for integration status
        └── pages/
            ├── AILayer.jsx
            ├── CRM.jsx
            ├── Dashboard.jsx
            ├── Integrations.jsx
            ├── LiveDashboard.jsx
            ├── Login.jsx
            └── Playbooks.jsx
```

**Notable structural issue:** `backend/src/config/database.js` exists alongside `backend/src/db/index.js`. Both configure PostgreSQL. `db/index.js` is the active one used by all models. `config/database.js` appears to be a legacy/unused file — see §11.

---

## 2. Frontend Routes

**Verified from `frontend/src/App.jsx`:**

| Route | Component | Status | Notes |
|-------|-----------|--------|-------|
| `/login` | `Login.jsx` | ✅ Implemented | Redirects to `/dashboard` if authenticated |
| `/dashboard` | `Dashboard.jsx` | ✅ Implemented | Executive metrics, funnel, AI suggestions |
| `/operativo` | `Playbooks.jsx` | ✅ Implemented | Automation playbooks (automation workflows) |
| `/playbooks` | `Navigate → /operativo` | ✅ Redirect | Legacy URL backward compatibility |
| `/crm` | `CRM.jsx` | ✅ Implemented | Lead pipeline table |
| `/live` | `LiveDashboard.jsx` | ✅ Implemented | Real-time metrics with auto-refresh |
| `/integrations` | `Integrations.jsx` | ✅ Implemented | Connect/test external services |
| `/ai` | `AILayer.jsx` | ✅ Implemented | AI content generation + campaign analysis |
| `*` | `Navigate → /dashboard` | ✅ Catch-all | Redirects unknown routes |

**Naming Decision (documented):** Route is `/operativo` (Spanish), Sidebar label is "Playbooks" (English). This hybrid is intentional — the route name preserves the product domain name while the UI label is English for clarity. A `/playbooks` redirect ensures backward compatibility.

---

## 3. Reusable Components

**Verified from `frontend/src/components/`:**

| Component | File | Status | Description |
|-----------|------|--------|-------------|
| `Layout` | `Layout.jsx` | ✅ Implemented | App shell: Sidebar + TopNav + `<Outlet />` |
| `Sidebar` | `Sidebar.jsx` | ✅ Implemented | Navigation with active state, user info, logout |
| `TopNav` | `TopNav.jsx` | ✅ Implemented | Header with search, notifications, user menu |
| `MetricCard` | `MetricCard.jsx` | ✅ Implemented | Metric display: value, icon, trend indicator |
| `FunnelChart` | `FunnelChart.jsx` | ✅ Implemented | Conversion funnel visualization (custom SVG bars) |
| `IntegrationCard` | `IntegrationCard.jsx` | ✅ Implemented | Connect/test integration with credential modal |

All 6 components exist and are actively used.

---

## 4. Backend Services

**Verified from `backend/src/services/`:**

| Service | File | Status | Notes |
|---------|------|--------|-------|
| Encryption | `encryption.js` | ✅ Implemented | AES-256-GCM + PBKDF2, native Node crypto |
| OpenAI | `openai.js` | ✅ Implemented | `generateContent` + `analyzeCampaign`, uses credential vault |
| Gemini | `gemini.js` | ✅ Implemented | Google Gemini API proxy |
| Meta | `meta.js` | ✅ Implemented | Marketing API: test, campaigns, metrics, trends |
| WhatsApp | `whatsapp.js` | ✅ Implemented | Business Cloud API: send message, test connection |
| Google | `google.js` | ⚠️ Partial | Calendar/Gmail OAuth helper; no full OAuth 2.0 flow |
| HubSpot | `hubspot.js` | ✅ Implemented | CRM trends, contact/deal sync |

**API Routes:**

| Route | File | Status | Notes |
|-------|------|--------|-------|
| `POST /api/auth/login` | `auth.js` | ⚠️ Partial | Works but user store is **in-memory** (data lost on restart) |
| `POST /api/auth/register` | `auth.js` | ⚠️ Partial | Same in-memory limitation |
| `GET /api/auth/me` | `auth.js` | ✅ Implemented | Returns decoded JWT payload |
| `GET /api/integrations` | `integrations.js` | ✅ Implemented | DB-first with in-memory fallback |
| `POST /api/integrations/:service/connect` | `integrations.js` | ✅ Implemented | Stores encrypted credential |
| `POST /api/integrations/:service/test` | `integrations.js` | ✅ Implemented | Live API test via credential vault |
| `GET /api/integrations/validate-all` | `integrations.js` | ✅ Implemented | Parallel test all connected services |
| `GET /api/credentials` | `credentials.js` | ✅ Implemented | Metadata only (no raw keys) |
| `POST /api/credentials` | `credentials.js` | ✅ Implemented | Encrypt + store |
| `DELETE /api/credentials/:service` | `credentials.js` | ✅ Implemented | Remove credential |
| `GET /api/dashboard/metrics` | `dashboard.js` | ✅ Implemented | Aggregates from real lead/integration data |
| `GET /api/dashboard/funnel` | `dashboard.js` | ✅ Implemented | Lead pipeline funnel from real data |
| `GET /api/dashboard/revenue-trend` | `dashboard.js` | ✅ Implemented | Revenue grouped by date from real data |
| `GET /api/dashboard/meta-trends` | `dashboard.js` | ✅ Implemented | Calls Meta API (requires credential) |
| `GET /api/dashboard/hubspot-trends` | `dashboard.js` | ✅ Implemented | Calls HubSpot API (requires credential) |
| `POST /api/ai/generate` | `ai.js` | ✅ Implemented | Calls OpenAI/Gemini (requires credential) |
| `POST /api/ai/analyze-campaign` | `ai.js` | ✅ Implemented | Campaign analysis via AI |
| `POST /api/ai/suggestions` | `ai.js` | ✅ Implemented | AI suggestions based on real lead/meta data |
| `GET /api/leads` | `leads.js` | ✅ Implemented | DB-first with in-memory fallback |
| `POST /api/leads` | `leads.js` | ✅ Implemented | Create lead |
| `PUT /api/leads/:id` | `leads.js` | ✅ Implemented | Update lead |
| `DELETE /api/leads/:id` | `leads.js` | ✅ Implemented | Delete lead |

---

## 5. Integration-Related Files

**Backend integration layer:**
- `backend/src/routes/integrations.js` — Full connect/test/list/validate flow
- `backend/src/services/meta.js` — Meta Marketing API (real HTTP calls)
- `backend/src/services/google.js` — Google Calendar/Gmail (partial OAuth)
- `backend/src/services/whatsapp.js` — WhatsApp Business Cloud API
- `backend/src/services/hubspot.js` — HubSpot CRM API
- `backend/src/services/openai.js` — OpenAI GPT-4
- `backend/src/services/gemini.js` — Google Gemini
- `backend/src/models/credential.js` — Encrypted credential vault
- `backend/src/models/integration.js` — Integration status tracking

**Frontend integration layer:**
- `frontend/src/pages/Integrations.jsx` — UI for connect/test/manage
- `frontend/src/components/IntegrationCard.jsx` — Per-service connect card
- `frontend/src/lib/supabase/integrations.js` — Supabase real-time sync
- `frontend/src/hooks/useIntegrations.js` — React hook for integration state

**Integration status:** Most services have real API call implementations. Google OAuth is partial (no full OAuth 2.0 callback flow, uses token passthrough).

---

## 6. Authentication Model

**Two authentication paths exist:**

### Path A: Custom Backend JWT (default when Supabase is not configured)
- Login: `POST /api/auth/login` → bcrypt compare → JWT signed with `JWT_SECRET`
- User store: **in-memory Map** in `backend/src/routes/auth.js` — **data is lost on server restart**
- Verification: `backend/src/middleware/auth.js` — `jwt.verify(token, config.jwtSecret)`

### Path B: Supabase Auth (when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` configured)
- Frontend: `supabase.auth.signInWithPassword` in `AuthContext.jsx`
- Backend: accepts Supabase JWTs when `SUPABASE_JWT_SECRET` is set
- User management: fully delegated to Supabase Auth

**Status:** ⚠️ Path A (custom JWT) user store is in-memory only. A restart clears all registered users. This is a development-only limitation, not production-ready.

---

## 7. Persistence Model

**HONEST ASSESSMENT:**

| Data Type | Storage | Status |
|-----------|---------|--------|
| Users | **In-memory Map** (auth.js) | ❌ Lost on restart |
| Leads | DB (PostgreSQL) **or** in-memory fallback | ⚠️ Fallback active without `DATABASE_URL` |
| Credentials (encrypted) | DB **or** in-memory fallback | ⚠️ Fallback active without `DATABASE_URL` |
| Integration status | DB **or** in-memory fallback | ⚠️ Fallback active without `DATABASE_URL` |

**DB-first pattern:** Models in `credential.js`, `integration.js`, `lead.js` all attempt the database first and fall back to in-memory. When `DATABASE_URL` is set, data persists. Without it, all data is lost on restart.

**Migration file:** `backend/src/db/migrations/001_initial_schema.sql` defines tables: `users`, `credentials`, `integrations`, `leads`. This schema is **not run automatically** — it must be applied manually.

---

## 8. Figma-Related Evidence

**What exists:**

| File | Status | Notes |
|------|--------|-------|
| `docs/figma-component-map.json` | ✅ Exists | File key `uJkwaJl7MIf5DE2VaqV8Vd` set; all node IDs are `REPLACE_WITH_NODE_ID` placeholders |
| `docs/figma-validation-audit.md` | ✅ Exists | Historical Phase 0 audit |
| `docs/figma-validation-spec.md` | ✅ Exists | Validation specification |
| `docs/FIGMA_SETUP.md` | ✅ Exists | Setup instructions |
| `scripts/validate-figma-mapping.js` | ✅ Exists | CLI validation tool — all checks pass (with warnings) |
| Figma Code Connect | ❌ Missing | No `figma.connect()` annotations in any component |
| Real Figma node IDs | ❌ Missing | All 13 entries (7 screens + 6 components) use placeholder values |
| Design token sync | ❌ Missing | Colors hardcoded in `tailwind.config.js`, not synced from Figma |

**Current validation result:** `PASS with warnings` — file/route checks pass; node ID warnings are expected (placeholders).

**Linked Figma file:** `https://www.figma.com/make/uJkwaJl7MIf5DE2VaqV8Vd/Crear-presentación-ejecutiva` — this is a **Figma Make** file. The `/v1/files` Figma REST API endpoint does **not support** Figma Make files (returns 400). Node IDs must be obtained by opening the file in Figma Make and copying frame links manually.

---

## 9. CI/CD Presence

**Verified from `.github/workflows/`:**

### `ci.yml` — Main CI pipeline
- Triggers: push to `main`, `copilot/**`, `feature/**`, `fix/**`; PR to `main`
- Jobs:
  1. `backend` — `npm ci` + `npm test` (30 Jest tests)
  2. `frontend` — `npm ci` + `npm run build` (Vite)
  3. `figma-validation` — `validate-figma-mapping.js --ci` (warn-only, posts PR comment)
- Status: ✅ Functional

### `validate-figma-mapping.yml` — Strict Figma validation
- Triggers: PR to `main`; push to `main`, `copilot/**`, `feature/**`, `fix/**`
- Job: installs frontend deps + runs `validate-figma-mapping.js` (strict mode)
- Note: Currently exits 0 because `validationRules.strictMode` is false in the JSON
- Status: ✅ Functional (but effectively non-blocking due to strictMode: false)

---

## 10. Deployment Config

**What exists:**
- `.env.example` files for backend and frontend (well-documented)
- `SUPABASE_SETUP.md` for Supabase deployment
- `backend/src/db/migrations/001_initial_schema.sql` for DB setup
- `.nvmrc` (Node 20)

**What is missing:**
- ❌ No `Dockerfile` or `docker-compose.yml`
- ❌ No deployment scripts (Heroku, Railway, Render, etc.)
- ❌ No production `Procfile`
- ❌ No environment-specific config beyond `.env.example`
- ❌ No database migration runner (schema must be applied manually)

---

## 11. Dead / Duplicate / Inconsistencies

### Potential Dead File
- `backend/src/config/database.js` — A PostgreSQL pool config that predates `backend/src/db/index.js`. No active `require()` calls point to this path. **Verify before removing:** `grep -r "config/database" backend/src/` returns zero results — file is unused.

### Stale Test Count in README
- README says "22 tests" but the backend actually has **30 tests** (verified by running `npm test`).

### Stale Branch Reference in Audit
- `docs/figma-validation-audit.md` says "Branch: feat/figma-validation-foundation" — this is a historical artifact from when Phase 0 was implemented. The current working branch is `copilot/full-repo-harden-design-code-align`.

### Dashboard TODO
- `frontend/src/pages/Dashboard.jsx` line: `params: { adAccountId: 'act_123456789' }` with comment `// TODO: Get from user settings`. This hardcoded ad account ID means Meta trends will fail for any account that isn't `act_123456789`. This is a functional bug, not cosmetic.

### No Figma Node IDs
- The `docs/figma-component-map.json` has file key `uJkwaJl7MIf5DE2VaqV8Vd` (appears to be real) but all 13 `figmaNodeId` fields are `REPLACE_WITH_NODE_ID`. No validation against real Figma nodes is possible until these are filled in.

### Misleading "100% Figma synced" (if claimed)
- No prior agent summary should claim 100% Figma sync. The validation system exists (Phase 0), but no actual Figma nodes are mapped, no design tokens are synced, and no Code Connect annotations exist.

---

## 12. Status Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Frontend SPA (React/Vite) | ✅ Implemented | 7 pages, 6 components, consistent routing |
| Backend API (Express) | ✅ Implemented | All routes functional, 30 tests pass |
| Authentication (custom JWT) | ⚠️ Partial | Works; user store is in-memory only |
| Authentication (Supabase) | ✅ Implemented | When env vars set |
| Credential vault (AES-256) | ✅ Implemented | DB-first + in-memory fallback |
| Lead management (CRM) | ✅ Implemented | DB-first + in-memory fallback |
| Integration status tracking | ✅ Implemented | DB-first + in-memory fallback |
| Meta API | ✅ Implemented | Real HTTP calls; requires credential |
| OpenAI/Gemini AI | ✅ Implemented | Real HTTP calls; requires credential |
| WhatsApp API | ✅ Implemented | Real HTTP calls; requires credential |
| Google OAuth | ⚠️ Partial | No full OAuth 2.0 flow |
| HubSpot CRM | ✅ Implemented | Real HTTP calls; requires credential |
| PostgreSQL persistence | ⚠️ Optional | In-memory fallback active by default |
| Figma file key | ⚠️ Placeholder-ready | File key set; node IDs are placeholders |
| Figma node ID mapping | ❌ Missing | All 13 are `REPLACE_WITH_NODE_ID` |
| Figma Code Connect | ❌ Missing | No annotations in any component |
| Design token sync | ❌ Missing | Colors hardcoded in Tailwind config |
| CI/CD (tests + build) | ✅ Implemented | GitHub Actions; 30 backend + Vite build |
| CI/CD (Figma validation) | ✅ Implemented | Warn-only; strict mode not yet active |
| Deployment config | ❌ Missing | No Docker, no Procfile, no deploy scripts |
| Docker / Compose | ❌ Missing | Not present |

---

## Honest Readiness Score

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Code completeness | 75/100 | Core app works; users in-memory, no Docker |
| Backend honesty | 70/100 | In-memory user store is unacknowledged prod gap |
| Frontend quality | 85/100 | Clean components, consistent routes, good UX |
| Documentation | 60/100 | README partially accurate; new docs added this pass |
| Figma readiness | 20/100 | Infrastructure exists; zero real node IDs |
| CI/CD | 75/100 | Tests + build pass; Figma is warn-only |
| Security | 80/100 | JWT + AES-256 + rate limiting; localStorage JWT is weak |
| **Overall** | **66/100** | Solid foundation; production needs DB + auth hardening |
