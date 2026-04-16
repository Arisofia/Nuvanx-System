# Repository Guidelines

## Project Structure & Module Organization

Monorepo with three independent sub-projects sharing a single git history:

- **`backend/`** — Node.js/Express REST API (`src/server.js` entry). Routes in `routes/`, business logic in `services/`, Supabase clients in `config/supabase.js`, DB migrations in `db/migrations/`.
- **`frontend/`** — React 19 + Vite SPA. Pages in `src/pages/`, reusable hooks in `src/hooks/`, Supabase client + Figma client in `src/lib/supabase/`.
**Key architectural constraints:**
- The backend uses two separate Supabase clients: `supabaseAdmin` (nuvanx-prod, `ssvvuuysgxyqvmovrlvk`) and `supabaseFigmaAdmin` (Figma project, `zpowfbeftxexzidlxndy`). Never mix them — routes/services must use the correct client for the target schema.
- All env config is centralised in `backend/src/config/env.js`. Add new env vars there; never read `process.env` directly in routes or services.
- Migrations are numbered sequentially (`001_`, `002_`, …). Do not reuse a prefix — duplicates break `supabase db push` ordering.
- Frontend calls the backend API only via `src/config/api.js` (base URL config). Do not hardcode `localhost` URLs in components.

## Build, Test, and Development Commands

```bash
# Install all dependencies (backend + frontend)
npm run install:all

# Start backend dev server (nodemon)
npm run dev:backend

# Start frontend dev server (Vite, http://localhost:5173)
npm run dev:frontend

# Run backend tests (all)
npm run test:backend

# Run a single backend test file
cd backend && npx jest tests/auth.test.js --runInBand --forceExit

# Lint frontend
npm run lint:frontend

# Validate Figma mapping
npm run validate:figma

# Push DB migrations to nuvanx-prod
npm run supabase:migration:push

# Generate TypeScript types from DB
npm run supabase:types
```

## Coding Style & Naming Conventions

- **Backend**: CommonJS (`require`/`module.exports`). No TypeScript. ESLint is not configured for the backend — follow existing file style.
- **Frontend**: ES modules (`import`/`export`). React functional components only. Tailwind CSS utility classes (dark theme: `bg-gray-900`, `text-white` base). ESLint configured via `frontend/eslint.config.js`.
- **Commits**: Conventional Commits — `fix(scope):`, `feat(scope):`, `chore(scope):`. Scope is the affected subsystem (e.g., `auth`, `figma`, `production-audit`).
- **Route files**: one Express router per resource. Register in `server.js` under `/api/<resource>`.
- **No mock data in production paths**: every route must read from DB or a real external API. Static arrays or hardcoded metrics are a production bug.

## Testing Guidelines

Framework: **Jest + Supertest** (backend only; no frontend tests).

```bash
cd backend && npm test          # all tests, runs in band
cd backend && npx jest tests/encryption.test.js --runInBand --forceExit  # single file
```

**Critical rule**: set all external API key env vars to `''` at the top of each test file **before** `require('../src/server')` — otherwise `dotenv.config()` will inject real credentials from `.env` into tests that assert 404 on missing credentials.

```js
process.env.GITHUB_TOKEN = '';
process.env.OPENAI_API_KEY = '';
// … then:
const app = require('../src/server');
```

## Commit & Pull Request Guidelines

Conventional Commits format is enforced by convention (not a hook). Use:

```
<type>(<scope>): <short description>

<body listing specific changes — bullets preferred for multi-file commits>
```

Common types seen in history: `feat`, `fix`, `chore`, `refactor`. Scopes match subsystems: `auth`, `figma`, `rls`, `env`.
