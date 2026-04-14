# Nuvanx System — AI-Powered Revenue Intelligence Platform

> **Revenue OS for Aesthetic Clinics** — CRM + AI Orchestration + Multi-Channel Automation in one unified platform.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Nuvanx Revenue Intelligence Platform              │
├───────────────────────┬─────────────────────────────────────────────┤
│     Frontend (React)  │           Backend (Node.js/Express)         │
│   ┌───────────────┐   │   ┌──────────────┐  ┌──────────────────┐   │
│   │  Dashboard    │   │   │  REST API    │  │  Credential Vault │  │
│   │  Playbooks    │◄──┼──►│  JWT Auth    │  │  (AES-256)       │  │
│   │  CRM          │   │   │  Rate Limit  │  └──────────────────┘  │
│   │  Live Metrics │   │   └──────────────┘                         │
│   │  Integrations │   │   ┌──────────────────────────────────────┐  │
│   │  AI Layer     │   │   │         Integration Layer            │  │
│   └───────────────┘   │   │  Meta │ Google │ WhatsApp │ GitHub   │  │
│                       │   │  OpenAI │ Gemini                     │  │
└───────────────────────┴───┴──────────────────────────────────────┴──┘
```

## Revenue Loop

```
Meta Ads → Lead → WhatsApp → Appointment → Treatment → Revenue
                      ↓
                  AI Optimizes
                      ↓
              Dashboard Live Metrics
```

---

## Project Structure

```
Nuvanx-System/
├── backend/                    # Node.js/Express API server
│   ├── src/
│   │   ├── server.js           # Express app (Helmet, CORS, rate-limiting)
│   │   ├── config/
│   │   │   ├── database.js     # PostgreSQL connection pool
│   │   │   └── env.js          # Environment config + validation
│   │   ├── middleware/
│   │   │   ├── auth.js         # JWT Bearer authentication
│   │   │   ├── errorHandler.js # Global error handler
│   │   │   └── rateLimiter.js  # Tiered rate limiting
│   │   ├── models/
│   │   │   ├── credential.js   # Encrypted credential storage
│   │   │   ├── integration.js  # Integration status tracking
│   │   │   └── lead.js         # CRM lead management
│   │   ├── routes/
│   │   │   ├── auth.js         # POST /api/auth/login|register
│   │   │   ├── credentials.js  # Credential vault CRUD
│   │   │   ├── integrations.js # Integration status + test connections
│   │   │   ├── leads.js        # CRM lead pipeline
│   │   │   ├── dashboard.js    # Metrics aggregation
│   │   │   └── ai.js           # AI content generation proxy
│   │   ├── services/
│   │   │   ├── encryption.js   # AES-256 encrypt/decrypt
│   │   │   ├── meta.js         # Meta Marketing API
│   │   │   ├── google.js       # Google Calendar + Gmail OAuth
│   │   │   ├── whatsapp.js     # WhatsApp Business Cloud API
│   │   │   ├── github.js       # GitHub API
│   │   │   ├── openai.js       # OpenAI GPT-4 proxy
│   │   │   └── gemini.js       # Google Gemini proxy
│   │   └── utils/
│   │       ├── logger.js       # Winston structured logging
│   │       └── validators.js   # express-validator rules
│   ├── tests/                  # Jest test suite (30 tests)
│   └── .env.example            # Required environment variables
│
└── frontend/                   # React/Vite SPA
    ├── src/
    │   ├── config/api.js       # Axios + JWT interceptors
    │   ├── context/AuthContext.jsx
    │   ├── hooks/
    │   │   ├── useApi.js       # Generic API hook
    │   │   └── useIntegrations.js
    │   ├── components/
    │   │   ├── Layout.jsx      # Sidebar + TopNav
    │   │   ├── Sidebar.jsx
    │   │   ├── MetricCard.jsx
    │   │   ├── FunnelChart.jsx
    │   │   └── IntegrationCard.jsx  # Connect + Test UI
    │   └── pages/
    │       ├── Login.jsx
    │       ├── Dashboard.jsx        # Executive metrics
    │       ├── Playbooks.jsx        # Automation playbooks
    │       ├── CRM.jsx              # Lead pipeline
    │       ├── LiveDashboard.jsx    # Real-time metrics
    │       ├── Integrations.jsx     # Integration management ★
    │       └── AILayer.jsx          # AI content generation
    └── .env.example
```

---

## Quick Start

### Unified Commands (Repo Root)

```bash
npm run install:all   # Install backend + frontend dependencies
npm run dev:backend   # Start backend in dev mode
npm run dev:frontend  # Start frontend in dev mode
npm run test:backend  # Run backend tests
npm run build:frontend
npm run validate:figma
```

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ (or Supabase)

### 1. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your values (see Environment Variables section)
npm install
npm start        # Production
npm run dev      # Development (nodemon)
```

### 2. Frontend Setup

```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL to your backend URL
npm install
npm run dev      # Development server
npm run build    # Production build
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Server
PORT=3001
NODE_ENV=development

# Security — generate strong random values
JWT_SECRET=<min-32-char-random-string>
ENCRYPTION_KEY=<min-32-char-random-string>

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/nuvanx

# CORS
FRONTEND_URL=http://localhost:5173
```

> ⚠️ **NEVER** commit `.env` files. User-submitted API keys are stored encrypted in the database/credential vault, while server-level environment variables may be configured as optional defaults or fallbacks.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:3001
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login → JWT |
| POST | `/api/auth/register` | User registration |
| GET | `/api/integrations` | List integrations + status |
| POST | `/api/integrations/:service/connect` | Store encrypted credential |
| POST | `/api/integrations/:service/test` | Test live connection |
| GET | `/api/credentials` | List credentials (metadata only) |
| POST | `/api/credentials` | Store encrypted API key |
| DELETE | `/api/credentials/:service` | Remove credential |
| GET | `/api/dashboard/metrics` | Aggregated revenue metrics |
| GET | `/api/dashboard/funnel` | Conversion funnel data |
| POST | `/api/ai/generate` | AI content generation |
| POST | `/api/ai/analyze-campaign` | Campaign optimization |
| GET | `/api/leads` | CRM lead list |
| POST | `/api/leads` | Create new lead |
| PUT | `/api/leads/:id` | Update lead status |

---

## Security Architecture

### Credential Vault
- All API keys encrypted with **AES-256** before storage
- Keys are **never returned** to the frontend
- `ENCRYPTION_KEY` lives only in server environment variables
- Rotation-ready: re-encrypt with new key without losing credentials

### API Security
- **JWT authentication** on all protected routes
- **Helmet.js** security headers
- **Rate limiting**: 100 req/15min (general), 20 req/15min (auth), 10 req/min (AI)
- **CORS**: locked to frontend URL only
- **Input validation**: express-validator on all inputs

### Frontend Security
- Zero API keys stored in browser
- JWT stored in localStorage (upgrade to httpOnly cookie for production)
- Automatic 401 → logout redirect

---

## Supported Integrations

> **Integration status:** All services support credential storage and connection testing via the Integrations page. Features marked ✅ are accessible via exposed API routes. Features marked ⚠️ are implemented in the service layer but not yet exposed via routes or frontend UI.

| Service | Auth Type | Available Functionality |
|---------|-----------|------------------------|
| **Meta Business** | Access Token | ✅ Connection test · ✅ Ad metrics and trends (`/api/dashboard/meta-trends`) |
| **HubSpot CRM** | Private App Token | ✅ Connection test · ✅ Pipeline trends (`/api/dashboard/hubspot-trends`) |
| **OpenAI GPT-4** | API Key | ✅ Content generation · ✅ Campaign analysis (`/api/ai/*`) |
| **Google Gemini** | API Key | ✅ Content generation · ✅ Campaign analysis (`/api/ai/*`) |
| **WhatsApp Business** | Cloud API Token | ✅ Connection test · ✅ Phone number discovery · ⚠️ Message send (service only, no route yet) |
| **Google Calendar** | OAuth2 Token | ✅ Connection test · ⚠️ Create/list events (service only, no route yet) |
| **Gmail** | OAuth2 Token | ✅ Connection test · ⚠️ Send email (service only, no route yet) |
| **GitHub** | Personal Access Token | ✅ Connection test |

---

## Testing

```bash
cd backend
npm test          # Run all 30 tests
npm test -- --watch   # Watch mode
```

Test coverage:
- ✅ AES-256 encrypt/decrypt roundtrip
- ✅ Credential vault (no raw keys returned)
- ✅ Integration connectors (mocked HTTP)
- ✅ Auth middleware (custom JWT + Supabase JWT)
- ✅ Credential CRUD (save, retrieve, list, delete)

---

## Design-to-Code Validation (Figma)

This repository includes a **Figma ↔ GitHub validation system** to maintain design-code consistency.

**Current Status:** Phase 0 (Foundation) — ⚠️ Warn-only mode

### Quick Start

```bash
# Ensure docs/figma-component-map.json is populated with your real Figma file key and node IDs (see FIGMA_SETUP.md)
# Then run validation:
node scripts/validate-figma-mapping.js
```

**CI Integration:**
- ✅ Runs automatically on every PR
- 💬 Posts validation report as PR comment
- ⚠️ Currently in warn-only mode (does not block merges)

**Documentation:**
- 📖 [Setup Guide](docs/FIGMA_SETUP.md) — Quick start + workflows
- 📋 [Validation Spec](docs/figma-validation-spec.md) — Full technical spec
- 🔍 [Audit Report](docs/figma-validation-audit.md) — Initial audit findings

**What It Validates:**
- ✅ All screens/components mapped to Figma nodes
- ✅ Code files exist at specified paths
- ✅ Routes match `App.jsx` definitions
- ✅ No duplicate component/screen names
- ✅ Mapping file freshness (staleness warnings)

**Future Phases:**
- 🔮 Phase 1: Figma API integration (strict mode)
- 🔮 Phase 2: Design token sync automation
- 🔮 Phase 3: Visual regression testing

---

## Roadmap

- [ ] PostgreSQL persistence (replace in-memory user store in auth.js)
- [ ] OAuth 2.0 flow for Google (currently token-based)
- [ ] Meta Webhooks receiver endpoint
- [ ] WhatsApp incoming message webhook
- [ ] WhatsApp send route (`/api/integrations/whatsapp/send`)
- [ ] Meta access token refresh mechanism
- [ ] Supabase deployment option
- [ ] Docker Compose setup
- [ ] Automated campaign AI loop

