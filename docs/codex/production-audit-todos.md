# Codex TODOs — Nuvanx Production Readiness Audit

_Last updated: 2026-05-18_

Use this checklist as the execution backlog for Codex. Each TODO has an owner persona, priority, commands, expected evidence, and completion criteria. Mark items complete only with production evidence, not local inference.

## Status legend

- `[ ]` Pending
- `[~]` In progress / partially verified
- `[x]` Confirmed complete with evidence
- `[!]` Blocked

## P0 — Release blockers

### TODO P0-01 — Verify Supabase access and deployed Edge Function

- **Owner:** Supabase / Edge Functions auditor
- **Scope:** Supabase project `ssvvuuysgxyqvmovrlvk`, Edge Function `api`
- **Risk:** Production backend may not match repo; deployment version claim is unverified.
- **Commands:**

```bash
export SUPABASE_ACCESS_TOKEN="<redacted>"
export SUPABASE_PROJECT_REF="ssvvuuysgxyqvmovrlvk"
supabase functions list --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --project-ref "$SUPABASE_PROJECT_REF"
```

- **Evidence required:** function name, status/version, updated timestamp, migration list remote/local alignment.
- **Completion criteria:** `api` is deployed, remote migrations match repo expectation, and any drift is documented.

### TODO P0-02 — Confirm deployed `api` matches repository code

- **Owner:** Release engineer
- **Scope:** `supabase/functions/api/index.ts`
- **Risk:** Local fixes may not be deployed.
- **Recommended change:** add or verify a version endpoint that returns `GIT_SHA`, function build timestamp, and semantic release label.
- **Commands:**

```bash
curl -sS "https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/health"
curl -sS "https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/health/version"
```

- **Evidence required:** response JSON with commit SHA or documented absence.
- **Completion criteria:** deployed function SHA equals the repository commit being audited, or a redeploy is performed and verified.

### TODO P0-03 — Validate Supabase Edge Function secrets

- **Owner:** Security auditor
- **Scope:** Supabase Edge Function secrets
- **Risk:** `ENCRYPTION_KEY` missing breaks credential decryption; service keys missing break API.
- **Commands:**

```bash
supabase secrets list --project-ref "ssvvuuysgxyqvmovrlvk"
curl -sS \
  -H "Authorization: Bearer $HEALTH_CHECK_API_AUTH_TOKEN" \
  "https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/health/secrets"
```

- **Required secrets:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NUVANX_SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`, and at least one usable AI provider path (`OPENAI_API_KEY`, `GEMINI_API_KEY`, or encrypted user credentials).
- **Evidence required:** redacted secret presence matrix; never print secret values.
- **Completion criteria:** all required secrets are present and `ENCRYPTION_KEY` is at least 32 characters.

### TODO P0-04 — Verify production `agent_outputs` schema and RLS

- **Owner:** Database auditor
- **Scope:** `public.agent_outputs`
- **Risk:** AI persistence fails if schema mismatch remains.
- **SQL:**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'agent_outputs'
  AND column_name IN ('output', 'metadata', 'output_text', 'input_context', 'output_data')
ORDER BY column_name;

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'agent_outputs'
ORDER BY policyname;
```

- **Expected:** `output`, `metadata`, `output_text`, and `input_context` exist; `output_data` is absent unless explicitly justified; anonymous writes are denied.
- **Completion criteria:** schema and RLS evidence attached to release note.

### TODO P0-05 — Run real AI generation and persistence smoke test

- **Owner:** Full-stack auditor
- **Scope:** Edge Function `api`, AI credentials, `agent_outputs`
- **Risk:** AI can appear wired in code but fail at runtime or fail to persist.
- **Command:**

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $HEALTH_CHECK_API_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  "https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/ai/generate" \
  -d '{"prompt":"Production audit smoke test. Reply with OK only.","contentType":"audit_smoke_test"}'
```

- **SQL verification:**

```sql
SELECT id, user_id, clinic_id, agent_type, output, metadata, created_at
FROM public.agent_outputs
WHERE metadata ->> 'contentType' = 'audit_smoke_test'
ORDER BY created_at DESC
LIMIT 5;
```

- **Completion criteria:** API returns `success: true`, non-null `outputId`, and a matching row exists in `agent_outputs`.

### TODO P0-06 — Verify Vercel production deployment and env vars

- **Owner:** Vercel auditor
- **Scope:** Vercel production project
- **Risk:** Frontend may point to wrong backend or lack public Supabase variables.
- **Commands:**

```bash
export VERCEL_TOKEN="<redacted>"
vercel inspect dpl_4YqxemmXtAqgWUp937LDi7EvCTAb --token "$VERCEL_TOKEN"
vercel env ls production --token "$VERCEL_TOKEN"
```

- **Required envs:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Completion criteria:** deployment is `READY`, promoted/aliased to production domain, and required envs exist in production.

### TODO P0-07 — Execute full production E2E

- **Owner:** QA / growth intelligence auditor
- **Scope:** Browser + API + DB + Meta + AI
- **Command:**

```bash
HEALTH_CHECK_API_AUTH_TOKEN="$REAL_USER_JWT" npm run production:e2e
```

- **Manual browser path:** login, dashboard, marketing, AI, financials, traceability.
- **Evidence required:** screenshots or network traces showing successful authenticated requests and no console auth/CORS errors.
- **Completion criteria:** login works, dashboard loads real data, `/api/meta/insights` succeeds or clearly reports degraded source, AI generates content, and persistence row is created.

## P1 — High-priority correctness and traceability

### TODO P1-01 — Fix or validate Meta messaging conversation metric

- **Owner:** Meta Graph API auditor
- **Scope:** `isMessagingConversationAction()` and `meta_daily_insights.messaging_conversations`
- **Risk:** Current matcher can over-count messages by including broad action types such as `lead` and `contact`.
- **Acceptance criteria:** raw `actions` from Graph API are stored or sampled; counted action types are documented; strict `messaging_conversation_started` KPI is not inflated by unrelated lead/contact actions.

### TODO P1-02 — Validate Meta account, page, campaigns, and March/April 2026 metrics

- **Owner:** Meta Ads auditor
- **Scope:** Meta Graph API account `act_9523446201036125`, page `685010274687129`
- **Commands:**

```bash
node scripts/verify-meta-access.js
curl -G "https://graph.facebook.com/v22.0/act_9523446201036125/insights" \
  --data-urlencode "fields=campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions" \
  --data-urlencode "level=campaign" \
  --data-urlencode "time_range={\"since\":\"2026-03-01\",\"until\":\"2026-04-30\"}" \
  --data-urlencode "access_token=$META_ACCESS_TOKEN"
```

- **Completion criteria:** Endolift, Láser CO2, and Laserlipólisis campaigns are confirmed by ID/name, and CTR/CPL/messages reconcile to raw API fields.

### TODO P1-03 — Verify Doctoralia and financial settlement truth set

- **Owner:** Data auditor
- **Scope:** `financial_settlements`, `doctoralia_patients`, `doctoralia_raw`, `produccion_intermediarios`
- **SQL:**

```sql
SELECT COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE COALESCE(status, '') ILIKE '%active%') AS active_like_rows,
       SUM(amount_net) AS amount_net_total
FROM public.financial_settlements;

SELECT COUNT(*) AS doctoralia_patients_total,
       COUNT(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized <> '') AS doctoralia_patients_with_phone
FROM public.doctoralia_patients;
```

- **Completion criteria:** counts and net revenue are confirmed or corrected; fake/duplicate/inconsistent rows are listed with remediation plan.

### TODO P1-04 — Harden runtime configuration fail-fast behavior

- **Owner:** Edge Functions engineer
- **Scope:** `supabase/functions/api/index.ts`, shared config
- **Risk:** Missing secrets may only log errors at initialization and produce route-level failures later.
- **Acceptance criteria:** missing critical runtime config returns deterministic health failure and prevents credential-dependent routes from executing with ambiguous errors.

### TODO P1-05 — Remove silent credential failure paths

- **Owner:** Security engineer
- **Scope:** Meta webhook and AI credential resolution
- **Risk:** Webhook leads can be dropped without actionable evidence.
- **Acceptance criteria:** decryption failures are logged with safe `error_id`, service name, user ID hash or redacted ID, and non-sensitive failure reason; no tokens or ciphertext are logged.

## P2 — Build, CI, and operations

### TODO P2-01 — Reproduce a clean frontend build

- **Owner:** Frontend engineer
- **Commands:**

```bash
rm -rf frontend/node_modules frontend/dist
npm --prefix frontend ci
npm --prefix frontend run build
```

- **Completion criteria:** Vite build finishes successfully and Vercel build command matches the verified workflow.

### TODO P2-02 — Resolve secret scanner false positive or real leak

- **Owner:** Security / CI engineer
- **Command:**

```bash
npm run secrets:scan
```

- **Completion criteria:** scanner passes, or the workflow sanitizer regex false positive is explicitly ignored with a narrow, documented allowlist.

### TODO P2-03 — Confirm root vs frontend Vercel config source of truth

- **Owner:** Vercel auditor
- **Scope:** `vercel.json`, `frontend/vercel.json`, Vercel project root directory setting
- **Completion criteria:** exactly one Vercel config is authoritative for production, and the other is removed or documented as intentionally unused.

### TODO P2-04 — Add release evidence template

- **Owner:** Release manager
- **Scope:** `docs/codex` or release notes
- **Completion criteria:** every production claim includes command, timestamp, environment, redacted output, commit SHA, deployment ID, and verification status.

## P3 — Documentation and commercial-readiness improvements

### TODO P3-01 — Update README development commands

- **Owner:** Documentation engineer
- **Risk:** README references scripts that do not exist in the current root `package.json`.
- **Completion criteria:** README commands match actual package scripts and production deploy process.

### TODO P3-02 — Document Doctoralia data freshness

- **Owner:** Data operations
- **Risk:** Operators may assume a live Doctoralia API when the documented integration is ingestion-based.
- **Completion criteria:** dashboard/reporting clearly displays data source, last ingestion timestamp, and freshness warnings.

### TODO P3-03 — Document KPI source-of-truth rules

- **Owner:** BI / growth analytics
- **Completion criteria:** Meta spend/leads, CRM leads, Doctoralia patients, verified revenue, CAC, CPL, and messaging conversations each have documented source table/API, freshness, fallback behavior, and confidence level.

## Final production go/no-go rule

Nuvanx is not production-ready for scaled campaign spend until every P0 item is complete, P1 metric risks are resolved or explicitly accepted, and a release note captures evidence for each production claim.
