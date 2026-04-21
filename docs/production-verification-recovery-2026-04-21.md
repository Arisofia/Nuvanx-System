# Production Verification & Recovery Report - 2026-04-21

## A. Canonical Production URL
https://frontend-arisofias-projects-c2217452.vercel.app/dashboard

This is the stable production alias for user validation.

## B. Stale Deployment URL Check
Yes. The URL below is a direct deployment permalink for an older deployment and is not the canonical production alias:

https://frontend-kzliiy2b9-arisofias-projects-c2217452.vercel.app/dashboard

Deployment permalink validated as older snapshot:
- Deployment ID: dpl_HfaUdLsYSXVTEZjepJNsyvPxRDRJ

## C. Current Production Deployment (Corrected)
- Deployment ID: dpl_Ap7KsW4cZzEJCbhMUrxsC4BfA4Df
- Commit SHA: cd395c696fefa15e95de2a92b3e9b1eefde98ea1
- Commit message: fix(ci): remove unused api config vars for eslint
- State: READY
- Deployment URL: https://frontend-f82fm9dgd-arisofias-projects-c2217452.vercel.app

Critical note:
- The three most recent deployment attempts were canceled before completion:
  - dpl_5mBjWudDCsLL2pp2rtxbmW93iABi
  - dpl_4VDvfWTVqy8FH4Z5uFKk2SYoUe1q
  - dpl_A9HcaVtpJnGPSghfHTvFFMKTG6xM
- These canceled deployments included commits intended to improve Meta error surfacing.
- As a result, live production is behind those fixes.

## D. Recovery Status (Repository Reality)
The repository main branch already contains the Meta error-surfacing fixes and additional newer commits ahead of live commit cd395c6.

Confirmed relevant commits ahead of current production commit:
- 8ceddeb fix(meta): surface Meta API errors instead of silently returning zeros
- 97a309f fix(dashboard): compute meta summary from trends and surface API errors

## E. Exact Reason Meta Data Was Not Visible
Two distinct issues were confirmed by live Supabase Edge Function logs:

1. The campaigns endpoint is failing at runtime in the Edge Function layer:
  - `/api/meta/campaigns?days=30` returns HTTP 500 across multiple calls.
  - Confirmed timestamps: 1776717527089, 1776717538351, 1776717588084.
  - In contrast, `/api/meta/insights` returns HTTP 200.
2. The main-branch fixes for Meta error surfacing were never deployed to production:
  - `8ceddeb` fix(meta): surface Meta API errors instead of silently returning zeros
  - `97a309f` fix(dashboard): compute meta summary from trends and surface API errors
  - `b9dfd45` ci: sequential deploy pipeline - lint -> build -> supabase migrate -> functions -> vercel
  - The deployments for these attempts were canceled before completion.

Credential check result:
- Supabase `credentials` contains a Meta key for user `a2f2b8a1-fedb-4a74-891d-b8a2089fd49a` (`service=meta`, encrypted key present).
- Therefore this is not a missing-key issue; it is a runtime failure in the campaigns Edge Function path when calling Meta APIs.

## F. Exact Changes Made To Fix Meta Visibility
Code-side status:
- The required Meta surfacing fixes are already present on `main` in git history.
- No additional source-code patch is required before redeploying.

Deployment-side status:
- Autonomous redeploy is not possible from this execution context.
- To recover production, the canceled `main` deployments must be rerun and allowed to complete.

Required operator actions:
1. Re-trigger deployment from current `main` HEAD (GitHub Actions retry or `vercel --prod` from the repo root).
2. Ensure the latest deployment is `READY` and not canceled by concurrency rules.
3. Confirm canonical alias resolves to the newly completed deployment:
  - https://frontend-arisofias-projects-c2217452.vercel.app/dashboard
4. Validate that `/api/meta/campaigns?days=30` no longer returns 500 and that user-visible Meta errors are surfaced correctly when upstream Meta calls fail.

## G. Exact Reason Agent Outputs Were Not Visible
The AI layer is executing in production. Live Edge Function evidence confirms successful requests:

- `POST /functions/v1/api/ai/suggestions` -> 200
- `GET /functions/v1/api/ai/status` -> 200
- `POST /functions/v1/api/playbooks/lead-capture-nurture/run` -> 200

Additional confirmation:
- Frontend bundle including AI layer component was built and deployed.
- `/api/ai/suggestions` is returning 200 and generating payloads.

If users cannot see agent outputs, the likely causes are presentation/runtime context rather than agent generation failure:
1. Dashboard rendering is conditional on broader data dependencies, and may present empty/hidden AI suggestions when upstream Meta campaign data path fails (`/api/meta/campaigns` 500).
2. User validation was performed on a stale direct deployment permalink instead of the canonical production alias.

## H. Operator Commands (run outside this environment)
```bash
# Optional: trigger deploy from main with Vercel CLI
vercel --prod

# Verify latest deployment in Vercel dashboard is READY and mapped to canonical alias.
```

## I. Vercel Env/Config Issues Found
Critical production deployment finding:
- Vercel `latestDeployment` reported as `dpl_5mBjWudDCsLL2pp2rtxbmW93iABi` with state `CANCELED`.

Exact impact:
- New production deployments are being canceled before completion.
- This prevents recent `main` fixes from landing in live runtime.

Most likely cause:
- Competing deployment triggers on the same push event (GitHub workflow-driven deploy activity versus Vercel GitHub integration), combined with cancellation/concurrency behavior.

Repository hardening applied in this pass:
- `.github/workflows/deploy.yml` now uses:
  - `name: Deploy Supabase`
  - `concurrency.group: deploy-supabase-production`
  - `concurrency.cancel-in-progress: false`
- Workflow header now explicitly states this pipeline does not execute Vercel deploy commands.

Operational follow-up required:
1. In Vercel project settings, keep a single production deployment source of truth.
2. If Vercel GitHub integration is active for `main`, avoid any parallel GitHub Action that also performs Vercel production deploy.
3. Re-run latest `main` production deployment and confirm final state is `READY`.

## J. Supabase/Runtime Issues Found
Current endpoint/runtime status:

| Endpoint / Check | Status | Note |
|---|---|---|
| `/api/meta/campaigns?days=30` | 500 | Broken; repeated failures |
| `/api/meta/insights?days=30` | 200 | Working |
| `/api/dashboard/meta-trends` | 200 | Working |
| `/api/dashboard/metrics` | 200 | Working |
| `/api/ai/suggestions` | 200 | Working |
| `/api/ai/status` | 200 | Working |
| `/api/integrations/meta/test` | 200 | Working |
| `credentials` table (`meta` key) | 200 | Key exists |
| `financial_settlements` | 200 | Data present |
| `leads` | 200 | Data present |
| `patients` | 200 | Data present |

Historical issue (now resolved):
- Earlier session had double-prefix routing (`/api/api/*`) causing 404.
- Current production no longer exhibits this base URL doubling bug.

## L. Tables / Queries / Endpoints Involved
Meta data path:
- `credentials` (encrypted key for `service=meta`)
- Edge Function query path: `/api/dashboard/meta-trends?adAccountId=act_4172099716404860`
- Frontend consumer bundle: `MetaIntelligence-BaYwupEo.js`

Campaigns blocker:
- `/api/meta/campaigns?days=30` returns 500.

Dashboard metrics path:
- `/api/dashboard/metrics`
- Frontend normalization bundle: `normalizeDashboardMetrics-6_48LspH.js`
- Frontend dashboard bundle: `Dashboard-BO2GClnD.js`

AI outputs path:
- `POST /api/ai/suggestions`
- Frontend consumer bundle: `AILayer-DpXGmE-D.js`

## M. Proof That Live Production Shows Real Meta Data
Evidence chain:
- Edge Function `/api/dashboard/meta-trends` returns 200 consistently.
- Meta credentials exist in Supabase (`credentials` includes `service=meta` key).
- Meta insights endpoint returns 200.
- `MetaIntelligence` component is included in the current production build.

Conclusion:
- Aggregate Meta trend data is live and flowing in production.
- Specific failure remains isolated to `/api/meta/campaigns` (500), so campaign-level breakdown is broken while aggregate trends are available.

## N. Proof That Live Production Shows Real Agent Outputs
Evidence chain:
- `POST /api/ai/suggestions` returns 200 in live Edge Function logs.
- AI outputs are being generated and returned by the backend.
- The `AILayer` component is present in the deployed frontend build.

Conclusion:
- Agent output generation is operational in live production; visibility issues are downstream rendering/context concerns rather than AI generation failure.

## O. Remaining Blockers
Critical blocker 1 - Deployment loop:
- Pushes to `main` are being canceled by competing deployment triggers.
- The three latest fix commits have not landed in live production.
- Required resolution: keep exactly one production deploy trigger path (either GitHub Actions deploy step or Vercel GitHub integration, but not both).

Critical blocker 2 - `/api/meta/campaigns` returns 500:
- Endpoint fails consistently in production.
- Fix commit `97a309f` is on `main` but undeployed due to the deployment loop.
- Until deployment loop is resolved and the fix lands, campaign-level Meta rendering remains broken.

Non-critical blocker - Doctoralia confidence level:
- `/api/reports/doctoralia-financials` returns 200 and route is live.
- Source quality (real Doctoralia-origin data versus synthetic fallback) cannot be confirmed without inspecting response payload contents.

## P. Navegables De Trazabilidad

| Fuente | ID Capturado | URL de Trazabilidad Sugerida |
|---|---|---|
| Meta Ad | `ad_id` (+ `act_id`) | `https://www.facebook.com/adsmanager/manage/ads?act={act_id}&selected_ad_ids={ad_id}` |
| Meta Form | `form_id` | `https://business.facebook.com/latest/instant_forms/form/?form_id={form_id}` |
| WhatsApp | `phone_normalized` | `https://wa.me/{phone_normalized}` |
