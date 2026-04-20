# Forensic Remediation — 2026-04-20 (Zero-Trust)

## Phase 0 — Safety & State Lock
- Branch created: `remediation-cleanup`
- CLI checks:
  - `vercel --version` → not installed; `npx vercel --version` blocked by npm registry 403.
  - `supabase --version` → not installed; `npx supabase --version` blocked by npm registry 403.

## Phase 1 — Inventory Classification

### ACTIVE
- `frontend/` SPA runtime and proxy config.
- `supabase/functions/api/index.ts` primary API runtime.
- `supabase/migrations/*` database schema source of truth.

### LEGACY (Removed)
- `backend/Procfile` (legacy Heroku/Proc manager artifact).
- `backend/railway.json` (legacy Railway deploy artifact).

### DUPLICATE
- No duplicate `.env` files found; only examples:
  - `backend/.env.example`
  - `frontend/.env.example`

### BROKEN / RISK DISCOVERED
- Meta account normalization accepted UUID-like values and transformed them into fake `act_` account IDs.
- AI analyze endpoint failed hard when primary provider failed, without provider-by-provider error visibility.
- Runtime verification to external endpoints blocked by egress proxy (`CONNECT tunnel failed, response 403`).

## Phase 2 — Architecture Truth Map
Canonical runtime chain confirmed in code:
1. Frontend hosted on Vercel (`frontend/vercel.json`).
2. `/api/:path*` rewrite → `https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/:path*`.
3. Edge Function routes DB access through Supabase service-role client.

## Phase 3 — Env/Secret Audit Commands (for operator execution)
Because CLI access is blocked in this environment, run these in your own terminal:

```bash
# Vercel (project scope)
vercel env ls

# Supabase function secrets (project linked)
supabase secrets list

# Required if missing
supabase secrets set OPENAI_API_KEY="<value>"
supabase secrets set META_ACCESS_TOKEN="<value>"
supabase secrets set ENCRYPTION_KEY="<value>"
```

## Phase 4/5 — Synchronization Remediation
Implemented in `supabase/functions/api/index.ts`:
- Added strict Meta ad account normalization:
  - Handles JSON-encoded metadata values.
  - Rejects UUID-like values.
  - Produces only `act_<digits>` format.
- Added AI provider fault isolation with fallback + explicit error details:
  - Try Gemini.
  - Fallback to OpenAI.
  - Return `502` with provider error list if both fail.
- Normalized response envelope to always include:
  - `success`
  - `data`
  - `error`

## Phase 6 — DB Integrity Commands (for operator execution)
Run these SQL checks in Supabase SQL editor:

```sql
-- 1) integrations metadata sanity
select count(*) as bad_rows
from integrations
where service = 'meta'
  and (
    metadata->>'adAccountId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or metadata->>'ad_account_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

-- 2) adAccountId repair template
update integrations
set metadata = jsonb_set(
  metadata,
  '{adAccountId}',
  to_jsonb(concat('act_', regexp_replace(coalesce(metadata->>'adAccountId', metadata->>'ad_account_id', ''), '[^0-9]', '', 'g'))),
  true
)
where service = 'meta'
  and regexp_replace(coalesce(metadata->>'adAccountId', metadata->>'ad_account_id', ''), '[^0-9]', '', 'g') <> ''
  and coalesce(metadata->>'adAccountId', metadata->>'ad_account_id', '') !~ '^act_[0-9]+$';

-- 3) agent_outputs health
select count(*) as agent_outputs_rows from agent_outputs;

-- 4) financial_settlements health
select count(*) as financial_settlements_rows from financial_settlements;
```

## Phase 7 — Real Runtime Verification
Attempted but blocked from this execution environment:
- `curl https://nuvanx.vercel.app/api/health` → `CONNECT tunnel failed, response 403`.
- `curl https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/health` → `CONNECT tunnel failed, response 403`.

## Phase 8 — Deployment
Not executable from this environment (Vercel CLI unavailable; npm 403 for CLI installation).
