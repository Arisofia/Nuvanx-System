# Nuvanx Dashboard Production Audit

Audit date: 2026-05-18  
Repository path audited: `/workspace/Nuvanx-System`  
Dashboard under audit: **Control de rendimiento médico**  
Meta accounts under audit: `act_9523446201036125`, `act_4172099716404860`  
Primary metric under audit: **Leads atribuidos**

## 1. Executive Verdict

Verdict: **NO-GO**

One-sentence reason: The dashboard contains real production data paths, but executive KPIs can still render silent zero fallbacks, ambiguous Meta-attributed lead labels, partial Meta account failures, cached/DB fallback data, and unreconciled Doctoralia revenue as decision-ready values.

Decision constraints: The dashboard must not be used for production CAC, CPL, revenue reporting, budget allocation, or medical performance decisions until the P0 items below are fixed and live endpoint/database values are reconciled against the rendered UI.

## 2. Audit Scope Completed

| Area | Completed? | Evidence | Gaps |
|---|---:|---|---|
| Dashboard frontend inventory | Yes | `frontend/src/pages/Dashboard.tsx`, `frontend/src/hooks/useDashboardData.ts`, dashboard components, dashboard helpers, validation helpers. | No browser session/live screenshot was taken because this audit changed migration/docs only and no runnable UI validation credentials were present. |
| Backend/API inventory | Yes | `supabase/functions/api/index.ts` route registry and handlers for dashboard, Meta, KPIs, traceability, webhooks, health. | Live endpoint calls were blocked by missing local Supabase/API credentials. |
| Database/migrations inventory | Yes | `supabase/migrations/*` tables/functions/views for Meta insights, Doctoralia, traceability, campaigns filter, matching. | Production-applied migration state could not be verified without database credentials. |
| CI/CD inventory | Yes | `.github/workflows/ci.yml`, `deploy.yml`, `secret-scan.yml`, `e2e-only.yml`, `supabase-security.yml`, health/audit/backfill workflows. | Latest GitHub Actions run logs were not available from the local checkout. |
| Secrets/configuration audit | Partial | Local environment presence check showed all production secrets absent in this execution environment. | GitHub/Vercel/Supabase secret stores cannot be inspected from this environment. |
| Live data validation | No | `VITE_SUPABASE_URL`, Supabase service role, `DATABASE_URL`, Meta and Doctoralia credentials were missing locally. | Required before any GO/CONDITIONAL GO decision. |

### Audit inventory

| Layer | File / Endpoint / Table | Purpose | Directly affects KPI? | Audit priority |
|---|---|---|---:|---:|
| Frontend | `frontend/src/pages/Dashboard.tsx` | Dashboard page state, filters, renders metric sections. | Yes | P0 |
| Frontend | `frontend/src/hooks/useDashboardData.ts` | Fetches `/dashboard/metrics`, `/dashboard/meta-trends`, `/meta/campaigns`, `/meta/insights`, `/dashboard/lead-flow`, `/kpis`; caches responses. | Yes | P0 |
| Frontend | `frontend/src/lib/dashboard-helpers.ts` | Canonical frontend formulas, fallbacks, KPI state construction. | Yes | P0 |
| Frontend | `frontend/src/lib/dashboard-validation.ts` | Payload normalization, request TTL, validation errors. | Yes | P0 |
| Frontend | `frontend/src/components/dashboard/MetricsGrid.tsx` | Renders Meta leads, CRM leads, Doctoralia revenue, close rate. | Yes | P0 |
| Frontend | `frontend/src/components/dashboard/FunnelAndSpendSection.tsx` | Renders Meta spend, attributed leads, CPL, CPC, funnel. | Yes | P0 |
| Frontend | `frontend/src/components/dashboard/RealROISection.tsx` | Renders real ROI/CAC/patient acquisition metrics. | Yes | P0 |
| Frontend | `frontend/src/components/dashboard/TrendSection.tsx` | Renders spend trend chart. | Yes | P1 |
| Frontend | `frontend/src/components/dashboard/FunnelChart.tsx` | Renders funnel stage counts. | Yes | P1 |
| Frontend | `frontend/src/components/ui/DataModeBadge.tsx` | Shows full/partial/demo data mode. | Yes | P0 |
| Frontend | `frontend/src/components/MetaAccountsNotice.tsx` | Displays audited Meta account IDs. | Yes | P1 |
| Frontend | `frontend/src/config/metaAccounts.ts` | Frontend default Meta account IDs. | Yes | P1 |
| Backend | `/dashboard/metrics` / `handleDashboardMetrics` | CRM, Meta DB, Doctoralia settlements summary. | Yes | P0 |
| Backend | `/dashboard/meta-trends` / `handleDashboardMetaTrends` | Meta spend trend; live + DB/cache fallback. | Yes | P0 |
| Backend | `/meta/insights` / `handleMetaInsightsGet` | Meta account insights across configured accounts. | Yes | P0 |
| Backend | `/meta/campaigns` / `handleMetaCampaignsGet` | Campaign list and per-campaign insights. | Yes | P0 |
| Backend | `/dashboard/lead-flow` / `handleDashboardLeadFlow` | Lead funnel from CRM stages. | Yes | P0 |
| Backend | `/dashboard/campaigns-filter` / `handleCampaignsFilter` | Doctoralia production campaigns RPC wrapper. | Yes | P1 |
| Backend | `/kpis` / `handleKpisGet` | Main KPI payload consumed by dashboard state. | Yes | P0 |
| Backend | `/traceability/funnel` / `handleTrazabilidadFunnel` | RPC-backed traceability funnel. | Yes | P0 |
| Backend | `/traceability/leads` / `handleTraceabilityLeads` | Traceability lead rows. | Yes | P0 |
| Backend | Meta webhook handlers | Ingest Meta Lead Ads into CRM. | Yes | P0 |
| Backend | Doctoralia ingestion/matching handlers/scripts | Ingest and reconcile Doctoralia revenue/patients. | Yes | P0 |
| Database | `leads` | CRM acquisition lead source/stage/converted patient fields. | Yes | P0 |
| Database | `meta_daily_insights` | Backfilled Meta spend/conversion cache. | Yes | P0 |
| Database | `financial_settlements` | Doctoralia revenue source. | Yes | P0 |
| Database | `doctoralia_patients` | Doctoralia patient matching source. | Yes | P0 |
| Database | `produccion_intermediarios` | Doctoralia production appointments/campaign filter source. | Yes | P1 |
| Database | `integrations`, `credentials` | Meta account/token configuration. | Yes | P0 |
| Database | `vw_lead_traceability`, `get_trazabilidad_funnel` | Lead-to-Doctoralia traceability and revenue attribution. | Yes | P0 |
| CI/CD | `.github/workflows/ci.yml` | PR lint, build, tests, e2e smoke, deno check. | Yes | P0 |
| CI/CD | `.github/workflows/deploy.yml` | Supabase migration/function deploy. | Yes | P0 |
| CI/CD | `.github/workflows/secret-scan.yml` | Repository secret scan. | Yes | P0 |
| CI/CD | `.github/workflows/e2e-only.yml` | Production E2E smoke by schedule/dispatch. | Yes | P1 |
| CI/CD | `.github/workflows/supabase-security.yml` | Supabase DB lint. | Yes | P0 |
| CI/CD | `.github/workflows/daily-health-check.yml` | Production endpoint health checks. | Yes | P1 |
| Secrets | Supabase URL/key/service role, Meta token/app secret/pixel, Doctoralia, WhatsApp, E2E, Vercel, GitHub Actions secrets | Runtime access to real data and deployments. | Yes | P0 |

## 3. Critical Blockers

| Priority | Area | Issue | Evidence | Business impact | Required fix |
|---|---|---|---|---|---|
| P0 | Frontend KPI truthfulness | `Leads Atribuidos` renders `metrics.metaConversions` without explaining action types or uniqueness. | `MetricsGrid.tsx` renders `metrics.metaConversions` and label `Leads Atribuidos`; `buildDashboardState` sets it from `kpisResponse.meta.leads` or Meta conversions. | Users can confuse Meta-attributed conversions with unique CRM leads or verified patients. | Rename to “Leads atribuidos por Meta”, add tooltip/action-type breakdown, and show CRM/Doctoralia separation. |
| P0 | Zero fallbacks | Multiple executive KPIs render `0` when source data is missing, denominator is zero, or fallback is null. | `dashboard-helpers.ts` defaults CRM, revenue, CAC, CPL, CPC to `0`; ROI section renders null CAC/revenue per lead as `0`. | Missing data can look like real zero cost/revenue/conversion. | Use `null`/unavailable states plus visible warning; only render `0` when source explicitly confirms real zero. |
| P0 | Backend KPI contract | `/kpis` returns `success: true` while using DB-only Meta `meta_daily_insights`, no account-level freshness, no error inspection, and zeros for CPL/CAC. | `handleKpisGet` queries DB rows and ignores query errors; returns `success: true`, `is_real` based on positive values only. | Executive KPIs can be silently incomplete or stale. | Return explicit source/freshness/account coverage/error metadata and fail/degrade if required sources are absent. |
| P0 | Meta account coverage | Both accounts can be configured, but partial live failure can be merged with DB fallback/cache and not surfaced in dashboard cards. | `/meta/insights` and trends include `degraded/message`, but dashboard only sets `metrics.metaError` for rejected frontend promises; fulfilled degraded payloads do not block metric rendering. | One account can disappear or become stale while totals still look real. | Surface account-level status in UI and block trusted totals if either audited account is missing/stale. |
| P0 | Doctoralia revenue trust | Revenue is from `financial_settlements.amount_net`, but dashboard date basis, matching confidence, and duplicate handling are inconsistent across handlers/RPC/view. | `/dashboard/metrics` sums settlements by `settled_at`; `/kpis` attributes patients via `converted_patient_id`; `get_trazabilidad_funnel` attributes settlements by phone and most recent lead. | CAC/revenue can mix settlement date and lead date or attribute revenue differently by card. | Define a single revenue attribution contract and reuse it in all dashboard endpoints. |
| P0 | CI/live validation | Production live data cannot be reconciled from this environment; CI workflows can skip deploy/security/e2e checks when secrets are missing. | Local env check shows secrets missing; workflows use warnings/skips for several production validation paths. | Cannot prove live dashboard numbers are real, fresh, or complete. | Make production validation secrets required for release, archive reconciliation artifacts, and fail on skipped P0 checks. |
| P1 | Migration safety | Canonical campaigns filter migration used unqualified drop. | Fixed in this PR to `DROP FUNCTION IF EXISTS public.get_campaigns_filter(date, date);`. | Avoids dropping/ambiguity around overloads. | Apply amended migration in environments where not yet applied; forward-fix production if already applied. |

## 4. Line-by-Line Findings

| File | Line / Range | Finding | Risk | Required fix |
|---|---|---|---|---|
| `frontend/src/pages/Dashboard.tsx` | 11-17 | Initializes date, campaign, and source filters; default 30 days and `ALL` filters. | No validation for custom date order before API calls. | Validate `customFrom <= customTo` and show blocking error. |
| `frontend/src/pages/Dashboard.tsx` | 18-37 | Calls `useDashboardData` with `campaignsCount`/`sourcesCount` hardcoded to `0`. | Hook comments say counts will update internally, but they are static inputs and can repeatedly repopulate lists. | Remove unused parameters or derive from state. |
| `frontend/src/pages/Dashboard.tsx` | 72 | Passes `quality?.metaAccountIds || []` to header. | If `/kpis` lacks account IDs, UI falls back to static defaults via `resolveMetaAccountIds`, which can imply verified coverage. | Distinguish configured vs verified account IDs. |
| `frontend/src/hooks/useDashboardData.ts` | 125-147 | 60-second in-memory request cache keyed by user/path. | UI has no visible “cached in browser” state. | Add freshness metadata to dashboard view. |
| `frontend/src/hooks/useDashboardData.ts` | 163-173 | Initializes executive KPIs to `0`. | Loading/error gaps can retain or show zero-like state. | Use nullable metrics until real payload validation succeeds. |
| `frontend/src/hooks/useDashboardData.ts` | 204-210 | Only `/dashboard/metrics` rejection throws; other endpoint failures become null. | `/kpis`, trends, campaigns, or insights can fail without blocking dashboard. | Treat P0 source failures as degraded/error, not silent null. |
| `frontend/src/hooks/useDashboardData.ts` | 256-268 | Blocks only when `/kpis` has `success !== true` and no metrics/campaigns. | A failing KPI endpoint can be masked by non-empty fallback data. | Fail or visibly degrade when KPI contract fails. |
| `frontend/src/hooks/useDashboardData.ts` | 270-273 | Demo flag is disabled in production and based only on Doctoralia patients. | Production partial/no-patient state may not be visibly labeled as demo/degraded. | Use data-quality modes in all environments. |
| `frontend/src/hooks/useDashboardData.ts` | 317-324 | Fetches dashboard resources in parallel. | `/dashboard/lead-flow` does not receive active date/campaign/source filters. | Pass date/source/campaign filters or clearly label all-time funnel. |
| `frontend/src/lib/dashboard-helpers.ts` | 66-82 | Falls back from insights summary to campaign-level insight sums using `?? 0`. | Missing campaign insights can become zero spend/conversions. | Track source completeness and missing-data counts. |
| `frontend/src/lib/dashboard-helpers.ts` | 126-130 | Uses `kpisResponse.meta.leads ?? metaConversions`; doctoralia patients/revenue default to zero. | Missing KPI payload becomes a numeric KPI. | Use null and contract validation. |
| `frontend/src/lib/dashboard-helpers.ts` | 134-144 | Converts missing metrics to `0`. | Unsafe zero fallback for CRM leads, rates, revenue, spend, conversions. | Preserve unknown as null/unavailable. |
| `frontend/src/lib/dashboard-helpers.ts` | 160-162 | Revenue per lead uses Doctoralia patients as denominator, not leads. | Label says lead but formula is revenue per verified patient/acquisition. | Rename or change formula. |
| `frontend/src/lib/dashboard-helpers.ts` | 170-171 | Null CAC becomes `0`; confidence string/number is passed through. | `low`/`high` strings render as `%` and width, producing invalid confidence UI. | Normalize confidence to explicit enum or numeric score. |
| `frontend/src/lib/dashboard-validation.ts` | 105-124 | Validation accepts missing `/kpis` by returning `quality: null`; booleans coerce missing to false. | Missing quality metadata is indistinguishable from partial data. | Make required KPI metadata mandatory for trusted mode. |
| `frontend/src/components/dashboard/MetricsGrid.tsx` | 36-43 | Displays `metrics.metaConversions` as `Leads Atribuidos`. | Ambiguous and not action-type documented. | Rename and add tooltip. |
| `frontend/src/components/dashboard/MetricsGrid.tsx` | 82-89 | Displays `verifiedRevenue` as Doctoralia verified. | No unavailable state if settlements query fails or returns missing. | Render unavailable/degraded metadata. |
| `frontend/src/components/dashboard/FunnelAndSpendSection.tsx` | 58-80 | Spend and CPL render numeric values; null CPL renders `0`. | Missing denominator/source can look like zero CPL. | Render `—` plus reason when not computable. |
| `frontend/src/components/dashboard/RealROISection.tsx` | 56-76 | Null CAC/revenue per lead renders as `0`; confidence assumes percentage. | CAC/revenue can mislead budget decisions. | Render blocked/unavailable until attribution is verified. |
| `frontend/src/components/ui/DataModeBadge.tsx` | 15-18 | Hides badge for `full_real` and undefined. | Undefined quality is not visibly unsafe. | Show “Data quality unknown” when absent. |
| `supabase/functions/api/index.ts` | 2370-2442 | `/dashboard/metrics` computes CRM, Meta DB spend, and Doctoralia settlements, then returns `success: true`. | Query errors are not checked; zeros may be missing data. | Check every Supabase response error/count/source. |
| `supabase/functions/api/index.ts` | 2494-2512 | Lead-flow uses all non-Doctoralia leads and divides by `(length || 1)`. | Empty/failing data returns zero-percent funnel as success. | Filter by dashboard range and distinguish empty vs failed. |
| `supabase/functions/api/index.ts` | 2529-2633 | Meta trends uses live, DB, or cache fallback and can return `success: true` with a degraded payload. | UI does not consistently surface degraded/cache status. | Require card-level degraded warnings and freshness. |
| `supabase/functions/api/index.ts` | 2663-2675 | Conversions are `rawConversions || messaging`; action type precedence is undocumented. | Messaging can replace zero Meta conversions, action mix unknown. | Return conversion action taxonomy and counts. |
| `supabase/functions/api/index.ts` | 2773-2812 | Merges accounts by date and drops account-level daily visibility in frontend payload. | Double counting/partial account issues hard to audit visually. | Include `per_account` coverage in dashboard. |
| `supabase/functions/api/index.ts` | 2889-2980 | `/meta/insights` falls back to cache/DB; partial account fallback possible. | Stale data may be rendered as real without UI blocking. | Expose TTL/last_success per account and force warning. |
| `supabase/functions/api/index.ts` | 5838-5956 | `/kpis` uses DB rows, positive-value `is_real`, and returns zero CPL/CAC on zero denominators. | Cannot trust core executive KPIs. | Implement strict KPI contract with nulls and source states. |
| `supabase/migrations/20260509120000_get_trazabilidad_funnel.sql` | 136-165 | Revenue attribution ranks each settlement to the latest eligible lead by phone. | Safer for duplicates, but different from `/kpis` `converted_patient_id` attribution. | Use one attribution function in dashboard. |
| `supabase/migrations/20260514090000_align_campaigns_filter_doctoralia_production.sql` | 7 | Function drop is now schema-qualified and signature-specific. | Reduces migration ambiguity. | Validate against Supabase migration dry-run. |

## 5. Metric Trust Matrix

| Metric | Source | Formula | Trust level | Can be used for decisions? | Notes |
|---|---|---|---|---:|---|
| Leads atribuidos | `/kpis` `meta.leads` or `/meta/insights` conversions | Meta conversions or CRM Meta lead count depending path | Not trusted | No | Ambiguous source/action types; can mix Meta API conversions and CRM leadgen counts. |
| Leads en BD | `leads` excluding `doctoralia` | Count in date range | Partially trusted | No | Query errors ignored in some handlers; source filter only affects some endpoints. |
| Ingresos reales | `financial_settlements.amount_net` | Sum positive Doctoralia settlements | Partially trusted | No | Settlement date basis and attribution differ across endpoints. |
| Tasa de cierre | `leads.stage` | treatment/closed divided by CRM leads | Partially trusted | No | Stage semantics not reconciled to Doctoralia verified patients. |
| Meta spend | Meta API or `meta_daily_insights` | Sum spend | Partially trusted | No | Partial account/cache fallback not always visible. |
| Meta CPL | spend / Meta attributed leads | `calculateRatio` or backend `metaSpend/metaLeads` | Not trusted | No | Null/zero handling can show `0`; denominator source ambiguous. |
| CAC Doctoralia | spend / attributed Doctoralia patients | `metaSpend/attributedPatients` | Not trusted | No | Patient attribution method inconsistent; zero fallback. |
| Revenue per lead | Doctoralia revenue / Doctoralia patients | Actually revenue per verified patient/acquisition | Not trusted | No | Label/formula mismatch. |
| Active campaigns | `/meta/campaigns` status | Count `ACTIVE` campaigns | Partially trusted | No | Account fallback/campaign filter interactions need live validation. |
| Trend spend | `/dashboard/meta-trends` | Date-merged Meta spend | Partially trusted | No | Cache/DB fallback exists; UI lacks freshness. |

## 6. Zero / Placeholder / Mock Data Findings

| Location | Value | Classification | Risk | Required fix |
|---|---|---|---|---|
| `useDashboardData.ts` initial metrics | `0` for all KPIs | UNSAFE_ZERO_FALLBACK | Loading/missing state can look like true zero. | Use nullable metrics and skeleton until validated. |
| `dashboard-helpers.ts` `EMPTY_COMBINED_METRICS`, `EMPTY_FUNNEL` | `0` for spend/leads/revenue/CAC | UNSAFE_ZERO_FALLBACK | Missing data becomes executive KPI zero. | Use unavailable state. |
| `dashboard-helpers.ts` lines 134-144 | `?? 0` conversions | UNSAFE_ZERO_FALLBACK | Payload omissions become zeros. | Contract validation and null handling. |
| `FunnelAndSpendSection.tsx` CPL | `'0'` when null | UNSAFE_ZERO_FALLBACK | Zero CPL can drive bad spend decisions. | Render `—` with reason. |
| `RealROISection.tsx` CAC/revenue per lead | `'0'` when null | UNSAFE_ZERO_FALLBACK | CAC/revenue reporting can be false. | Render unavailable/degraded. |
| `DataModeBadge.tsx` undefined | No badge | UNKNOWN | Unknown quality appears normal. | Show unknown/degraded badge. |
| `/dashboard/lead-flow` | denominator `1` for empty data | UNSAFE_ZERO_FALLBACK | Empty/failure can become zero-percent funnel. | Return explicit empty state. |
| `/kpis` CPL/CAC/avgTicket | `0` on zero denominator | UNSAFE_ZERO_FALLBACK | Missing denominators look like free acquisition. | Return null and explanatory metadata. |
| Production code search | `demo` paths | MOCK_PRODUCTION_RISK | Demo user fallback exists in auth bootstrap and data mode naming exists. | Ensure no demo user/data path can serve production dashboard. |

## 7. Meta Attribution Findings

| Item | Finding | Evidence | Risk | Fix |
|---|---|---|---|---|
| Exact displayed field | `metrics.metaConversions` in `MetricsGrid`; `combined.metaEstimatedLeads` in Meta Analytics. | Frontend metric components. | Ambiguous. | Label as Meta-attributed conversions/leads. |
| Calculating function | `buildDashboardState` uses `kpisResponse.meta.leads ?? metaConversions`. | `dashboard-helpers.ts`. | Source can switch silently. | Include source in metric object. |
| Endpoint source | `/kpis` and `/meta/insights`; dashboard also fetches `/dashboard/metrics`. | `useDashboardData.ts`. | Multiple paths can diverge. | Use one canonical source. |
| Both accounts included? | Config/migrations include both account IDs, backend iterates `creds.adAccountIds`. | `metaAccounts.ts`, Meta handlers, restore migration. | Not live verified. | Validate live rows/calls per account. |
| Merge method | Sums live rows per account or DB fallback rows; trends merge by date. | Meta handlers. | Double count possible if same conversion/action exists across accounts; no unique-person dedupe. | Return account/action breakdown and dedupe policy. |
| Action types | Uses Meta `conversions` field; fallback action filters include strings containing `lead`, `conversion`, `complete_registration`; messaging has its own helper. | Meta insight aggregation/persistence. | Unknown exact action taxonomy. | Persist action_type counts and document attribution window. |
| WhatsApp/messaging included? | Messaging conversations are separately counted and can replace zero conversions in summary. | `aggregateMetaInsightsSummary`. | Users may read messaging as leads. | Split Lead Form, WhatsApp/messaging, contact actions. |
| Attribution window | Not documented in UI/API contract. | No explicit attribution window found. | Cannot audit Meta conversion period. | Include Meta attribution settings/window in API metadata. |
| Campaign/source filters | Campaign filter goes to Meta insights/campaigns; source filter goes to dashboard/kpis but not lead-flow. | `useDashboardData.ts`. | Cross-card mismatches. | Apply filters consistently or label scope differences. |
| One account failure | Backend can fallback/merge and mark degraded; frontend does not block cards. | Meta handlers and hook. | Partial account totals can look complete. | Show per-account failure in dashboard header/cards. |

## 8. Meta Account Coverage

| Account ID | Included? | Spend? | Leads? | Freshness | Errors | Verdict |
|---|---:|---:|---:|---|---|---|
| `act_9523446201036125` | Configured in frontend and integration restore migration; backend can iterate if credentials include it. | Unknown live | Unknown live | Unknown live | No live credentials | Not production-verified |
| `act_4172099716404860` | Configured in frontend and integration restore migration; backend can iterate if credentials include it. | Unknown live | Unknown live | Unknown live | No live credentials | Not production-verified |

## 9. Doctoralia Revenue Findings

| Area | Finding | Evidence | Risk | Fix |
|---|---|---|---|---|
| Revenue table | `financial_settlements` stores Doctoralia `amount_net`, `settled_at`, `cancelled_at`, `source_system`. | Dashboard/KPI handlers query this table. | Real source path exists but live state unknown. | Verify production counts and freshness. |
| Verified revenue field | `amount_net` filtered `source_system='doctoralia'`, `cancelled_at IS NULL`, `amount_net > 0`. | `/dashboard/metrics`, `/kpis`. | Field looks like settlement amount, but not reconciled to bank/payment state here. | Define “verified” contract. |
| Matching logic | `/kpis` counts patients matched by `leads.converted_patient_id`; traceability RPC uses phone and ranks settlement to one lead. | Backend and migration. | Different cards can disagree. | Centralize attribution in one RPC/view. |
| Duplicate risk | `get_trazabilidad_funnel` ranks each settlement once, but `/kpis` sums settlement revenue and separately counts attributed patients. | SQL and backend. | Revenue/patient denominator can be inconsistent. | Use settlement-level attribution output for all KPIs. |
| Missing risk | Unmatched Doctoralia patients are included in verified revenue but excluded from `newVerifiedPatients` denominator. | `/kpis`. | Avg ticket/CAC can be inflated/deflated. | Surface matched/unmatched counts and exclude or include consistently. |
| Date basis | `/kpis` revenue by `settled_at`; lead counts by `created_at`; traceability has lead and appointment date filters. | Backend/RPC. | Period mismatch. | Decide lead-date vs settlement-date dashboard mode. |

## 10. API Contract Findings

| Endpoint | Status | Risk | Required fix |
|---|---|---|---|
| `/dashboard/metrics` | Returns real-data summary but does not check all query errors before defaulting arrays. | Silent zeros. | Validate each Supabase response and include `degraded/errors`. |
| `/dashboard/meta-trends` | Supports live/DB/cache fallback and degraded metadata. | UI does not fully consume degradation/freshness. | Include per-account freshness and render warnings. |
| `/meta/campaigns` | Campaign source includes Meta API and CRM fallback paths. | Campaign counts can switch source. | Label source and account coverage per campaign. |
| `/meta/insights` | Multi-account live calls with DB/cache fallback. | Partial account failures may remain decision-visible. | Block trusted metrics unless both audited accounts current. |
| `/dashboard/lead-flow` | Returns `success: true` with all-time, non-filtered CRM lead stages. | Mismatch with date/campaign/source cards. | Apply dashboard filters or label all-time. |
| `/kpis` | Main KPI endpoint returns `success: true` without strict source/freshness/error contract. | P0. | Implement strict schema with nullable unknowns. |
| `/traceability/funnel` | RPC-backed traceability route exists. | Production data availability unknown. | Reconcile to dashboard KPI values. |
| `/traceability/leads` | View-backed traceability rows. | Live view consistency unknown. | Validate row counts and duplicates. |
| `/health/secrets` | Health routes exist in API registry/health scripts. | Must avoid leaking secret values. | Keep presence-only responses and scan logs. |

## 11. CI/CD Findings

| Workflow | Job | Status | Blocking? | Required fix |
|---|---|---|---:|---|
| `.github/workflows/ci.yml` | YAML safety | Present. | Yes if failing. | Keep blocking. |
| `.github/workflows/ci.yml` | Frontend ESLint/unit/build | Present. | Yes if failing. | Keep blocking; do not allow fallback env for production release gates. |
| `.github/workflows/ci.yml` | Playwright smoke | Can skip on missing `E2E_EMAIL`/`E2E_PASSWORD`. | P1 | For production release, fail instead of skip. |
| `.github/workflows/ci.yml` | Edge Deno check | Present. | Yes if failing. | Keep blocking. |
| `.github/workflows/deploy.yml` | Supabase migrations/functions | Can skip on missing Supabase secrets. | P0 for production | Production deploy workflow must fail on missing required secrets. |
| `.github/workflows/secret-scan.yml` | Repository secret scan | Present. | Yes if failing. | Keep blocking. |
| `.github/workflows/supabase-security.yml` | DB lint | Can skip on missing Supabase secrets. | P0 for production | Fail in protected release context. |
| `.github/workflows/e2e-only.yml` | Production E2E | Can skip on missing production E2E secrets. | P1 | Make scheduled production E2E alert/fail on missing secrets. |
| `.github/workflows/daily-health-check.yml` | Health check | Fails missing Supabase URL; optional auth token warns. | P1 | Authenticated dashboard checks should be mandatory for production confidence. |

## 12. Security / Secrets Findings

| Secret / Area | Status | Risk | Required fix |
|---|---|---|---|
| Supabase frontend env vars | Missing locally; workflow allows PR build warnings. | Build can pass without operational config. | Require for production environment. |
| Supabase service role / DB URL | Missing locally; deploy/security can skip. | Cannot validate production schema/data. | Required protected secrets. |
| Meta access token/app secret/pixel ID | Missing locally; pixel has hardcoded default ID fallback. | Live Meta cannot be verified; wrong pixel fallback risk. | Require configured pixel/token in production. |
| Doctoralia credentials | Missing locally. | Revenue ingestion/freshness not verifiable. | Required ingestion health check. |
| WhatsApp tokens | Not live verified. | Webhook coverage unknown. | Add webhook secret health check. |
| E2E credentials | Missing locally; CI can skip. | UI truthfulness not continuously validated. | Mandatory production smoke credentials. |
| Logs | Deploy workflow sanitizes DB URLs/token/key patterns. | Positive control. | Extend to all scripts/backfills. |

## 13. Database / Migration Findings

| Migration / Function / Table | Status | Risk | Required fix |
|---|---|---|---|
| `20260504120000_meta_daily_insights.sql` | Creates cached Meta daily table with default zeros. | Default zeros can mean missing metrics unless row provenance/freshness checked. | Add freshness/completeness checks per account/date. |
| `20260507150000_restore_meta_ad_account_ids.sql` | Restores both audited account IDs for one user integration. | Hardcoded user migration does not prove current production credentials. | Verify integrations table live. |
| `20260509120000_get_trazabilidad_funnel.sql` | RPC attributes each settlement once by phone to latest eligible lead. | Good duplicate control but not reused by dashboard KPIs. | Make dashboard source-of-truth. |
| `20260513200000_create_produccion_intermediarios.sql` | Doctoralia production staging table with phone extraction. | `importe DEFAULT 0` may hide missing imported amounts. | Track import validation errors and null/zero semantics. |
| `20260514090000_align_campaigns_filter_doctoralia_production.sql` | Campaign filter RPC from Doctoralia production. | Previously unqualified drop; fixed in this PR. | Dry-run migrations. |
| `20260513120000_create_get_campaigns_filter.sql` | Legacy cleanup now drops exact public `(date,date)` signature. | Safer legacy cleanup. | Confirm migration history in Supabase. |
| Matching migrations `20260515174500`, `20260515180000`, `20260515181000`, `20260515183000` | DNI/name/phone/reconciliation improvements. | Need live duplicate/unmatched validation. | Run validation SQL and compare to UI. |

## 14. Required Fixes Before GO

| Priority | Fix | Owner | Validation required |
|---|---|---|---|
| P0 | Replace all executive KPI unsafe zero fallbacks with nullable unavailable/degraded states. | Frontend + API | Unit tests for missing/failing endpoints; UI smoke confirms no fake zero. |
| P0 | Create a single canonical KPI contract for Meta leads, CRM leads, Doctoralia patients, revenue, CPL, CAC. | Backend/Data | Contract tests for source/freshness/null semantics. |
| P0 | Show “Leads atribuidos por Meta” with action-type tooltip and separate CRM/Doctoralia counts. | Frontend/Product | Screenshot and Playwright assertion. |
| P0 | Add per-account Meta status/freshness and block trusted totals if either audited account missing/stale. | Backend + Frontend | Live validation for both account IDs. |
| P0 | Reconcile Doctoralia revenue attribution through one SQL function/view and use it for all dashboard cards. | Data | Duplicate/unmatched revenue SQL checks. |
| P0 | Make production deploy/security/live E2E checks fail on missing required secrets. | DevOps | Protected branch CI run with artifacts. |
| P0 | Run live reconciliation queries for Meta, CRM, Doctoralia, funnel, and compare with UI. | Data/QA | Saved query output and UI screenshots. |
| P1 | Normalize data quality badges so unknown/degraded/cache states are visible in production. | Frontend | Component tests and screenshot. |
| P1 | Apply dashboard date/source/campaign filters consistently to funnel/trends/KPIs. | Frontend + API | Cross-endpoint contract tests. |

## 15. Final GO / NO-GO Decision

Final verdict: **NO-GO**

Rationale: The codebase contains real integration and reconciliation work, including multi-account Meta handlers and Doctoralia settlement sources, but the current dashboard contract still permits unknown, partial, stale, or failed data to render as numeric executive KPIs; the primary “Leads atribuidos” metric is not sufficiently separated from CRM leads or Doctoralia patients; both Meta accounts and Doctoralia revenue could not be live-reconciled in this environment.

Allowed use: Engineering audit, data-quality remediation, and directional internal debugging only.

Blocked use: Production budget allocation, CAC/CPL decisions, revenue reporting, operational medical performance decisions, and executive reporting.
