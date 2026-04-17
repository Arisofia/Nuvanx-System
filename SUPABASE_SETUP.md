# Supabase Setup — Nuvanx

> **Production project:** `ssvvuuysgxyqvmovrlvk` (`nuvanx-prod`)
> URL: `https://ssvvuuysgxyqvmovrlvk.supabase.co`
>
> **Figma project:** `zpowfbeftxexzidlxndy` (Figma dashboard sync)
> URL: `https://zpowfbeftxexzidlxndy.supabase.co`

## Architecture

- **Backend** uses two Supabase admin clients (see `backend/src/config/supabase.js`):
  - `supabaseAdmin` → nuvanx-prod (auth, credentials, integrations, leads, playbooks, clinics)
  - `supabaseFigmaAdmin` → Figma project (design tokens, figma sync, dashboard metrics)
- **Frontend** connects to nuvanx-prod via the anon key for auth and real-time features.
- API credentials (Meta, OpenAI, etc.) are encrypted with **AES-256-GCM** in the backend vault — never stored in the browser.

## Database Schema

The schema is managed through numbered migrations in two locations:

```
backend/src/db/migrations/     # Backend migrations (001_ through 016_+)
supabase/migrations/           # Supabase CLI migrations (timestamp-prefixed)
```

Key tables (nuvanx-prod):
- `users` — Auth users with clinic assignment
- `clinics` — Multi-tenant isolation
- `credentials` — Encrypted API keys (AES-256-GCM vault)
- `integrations` — Integration connection status per user
- `leads` — CRM lead records with deduplication
- `playbooks` / `playbook_executions` — Automation playbooks
- `dashboard_metrics` — Aggregated dashboard data
- `design_tokens` — Design system tokens synced from Figma

> **Important:** Do NOT reference legacy shadow tables (`user_integrations`,
> `user_credentials`, `kpi_definitions`, `kpi_values`). They were removed.

## Environment Variables

### Frontend (`frontend/.env.local`)

```bash
VITE_SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### Backend (`backend/.env`)

```bash
DATABASE_URL=postgresql://postgres:<password>@db.ssvvuuysgxyqvmovrlvk.supabase.co:5432/postgres
SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
SUPABASE_FIGMA_URL=https://zpowfbeftxexzidlxndy.supabase.co
SUPABASE_FIGMA_SERVICE_KEY=<figma-service-role-key>
```

All env vars are centralized in `backend/src/config/env.js`. Never read `process.env` directly in routes or services.

## Setup Steps

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Copy the **Project URL** and **anon key** from Project Settings → API
3. Set environment variables as shown above
4. Run migrations: `npm run supabase:migration:push`
5. Install frontend dependency: `cd frontend && npm install @supabase/supabase-js`

## Security

- RLS is enabled on all tables — users can only access their own records
- The `anon` key is safe for frontend use (scoped by RLS policies)
- Never use the `service_role` key in frontend code
- The backend `ENCRYPTION_KEY` env var is required for credential vault operations

## Relevant Files

```
backend/src/config/supabase.js         # Admin clients (nuvanx-prod + Figma)
backend/src/config/env.js              # Centralized env config
backend/src/db/migrations/             # Sequential numbered migrations
frontend/src/lib/supabase/client.js    # Frontend Supabase singleton
supabase/config.toml                   # Supabase CLI config
supabase/migrations/                   # Supabase CLI migrations
```
