# Codex Environment Blueprint (Nuvanx-System)

Use this blueprint when creating the Codex cloud environment for this repository.

## Startup script
- Path: `.codex/setup.sh`

## Working directory
- `/workspace/Nuvanx-System`

## Required environment variables

### Frontend (Vercel/Supabase)
- `VITE_SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<supabase_publishable_key>`
- Optional fallback: `VITE_SUPABASE_ANON_KEY=<supabase_anon_key>`
- Optional: `VITE_API_URL=` (empty in production when using Vercel `/api/*` rewrites)

### Backend / Integrations
- `JWT_SECRET=<jwt_secret>`
- `SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service_role_key>`
- `SUPABASE_FIGMA_URL=https://zpowfbeftxexzidlxndy.supabase.co`
- `SUPABASE_FIGMA_SERVICE_ROLE_KEY=<figma_service_role_key>`

## Verification commands
Run after setup:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend test
```
