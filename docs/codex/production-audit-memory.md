# Nuvanx Production Audit Memory

_Last updated: 2026-05-18_

This file records the current audit baseline for future Codex sessions. Treat these statements as the working memory for production-readiness work until they are superseded by fresh evidence.

## Operating context

- Project: Nuvanx.
- Frontend: React/Vite deployed on Vercel.
- Primary backend: Supabase Edge Function `api`.
- Database: Supabase project `ssvvuuysgxyqvmovrlvk` (`nuvanx-prod`).
- Integrations: Meta Ads / Meta Graph API, Doctoralia ingestion, OpenAI/Gemini, WhatsApp.
- Production objective: prove that repo code, deployed Edge Function, Vercel frontend, Supabase database schema/data, secrets, and third-party integrations are aligned and functional.

## Audit baseline

### Confirmed locally

- The repository was clean at audit time on branch `work`, HEAD `19ac2b7`.
- Root `vercel.json` rewrites `/api/:path*` to `https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/:path*`.
- The local Edge Function `supabase/functions/api/index.ts` includes routes for Meta, AI, financials, reports, Doctoralia agenda, health, and production audit.
- `persistAgentOutput()` inserts into `agent_outputs` with `user_id`, `clinic_id`, `agent_type`, `output_text`, `output`, `metadata`, and `input_context`.
- Local unit tests passed with `npm test`.
- `financial_settlements` has a local hardening migration that enables RLS, revokes writes from `anon`, `authenticated`, and `public`, and scopes reads by clinic.

### Not verified in production

- Whether Supabase Edge Function `api` v32 is deployed.
- Whether the deployed `api` bundle matches the local repository.
- Whether all Supabase migrations are applied remotely.
- Whether `agent_outputs` actually contains `output`, `metadata`, `output_text`, `input_context`, and no legacy `output_data` in production.
- Whether fake users matching `e2e-*@nuvanx.test` were removed from both `auth.users` and `public.users`.
- Whether `financial_settlements` has 91 total rows, 70 active rows, and €79,288.66 net verified revenue.
- Whether Meta account `act_9523446201036125` and page `685010274687129` are valid, permissioned, and actively returning real data.
- Whether March/April 2026 Meta campaign metrics and Endolift / Láser CO2 / Laserlipólisis campaign claims are traceable from Graph API raw responses.
- Whether Vercel deployment `dpl_4YqxemmXtAqgWUp937LDi7EvCTAb` is promoted to production.
- Whether Vercel production has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Whether a full production E2E path works: login, dashboard, `/api`, Meta query, AI generation, and `agent_outputs` persistence.

### Known risks

- `persistAgentOutput()` depends on columns that must be verified remotely before declaring the agent layer production-ready.
- The Meta messaging matcher is broad: it counts action types containing `conversation_started`, `messaging`, `whatsapp`, `lead`, `contact`, `submit_application`, or exactly `onsite_conversion.messaging_conversation_started_7d`. This can overstate messaging conversations if used as a strict `messaging_conversation_started` KPI.
- Edge runtime configuration validation logs missing critical secrets but does not fully prevent runtime execution after initialization failures.
- Some credential decryption failures are intentionally degraded or silent, notably Meta webhook lead processing and AI fallback to environment-level provider keys.
- `meta_cache` and DB fallback can make Meta endpoints appear available while serving stale or degraded data.
- Doctoralia is documented as ingestion-based, not a live Doctoralia API integration.
- The frontend build was not confirmed in the audit environment because local dependency installation/build was blocked or incomplete.
- Production HTTP checks failed from the audit environment due network/proxy restrictions; they must be rerun from an allowed environment.

## Evidence discipline for future Codex runs

Do not mark any production item as complete unless the final response includes:

1. The exact command or SQL executed.
2. Timestamp and target environment.
3. Redacted response evidence.
4. The commit SHA and deployment/function version checked.
5. A clear label: `confirmed`, `inferred`, `not verifiable`, `false`, or `risk pending`.

## Non-destructive-first rule

Prefer read-only checks. If a write is required, use a uniquely identifiable audit marker and document cleanup or rollback.
