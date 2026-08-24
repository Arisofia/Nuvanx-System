# Google access inventory — NUVANX

Last verified: 2026-08-24

## Purpose

This document is the canonical, redacted inventory of Google-related access paths used by NUVANX across `Arisofia/Nuvanx-System` and `NUVANX-Medicina-Estetica-Laser/nuvanx-siteground`.

It records **logical credential names, non-secret resource identifiers, intended scopes, runtime owners and verification status only**. Never add secret values, OAuth tokens, private keys, refresh tokens, API keys or credential JSON payloads to this document, issues, PRs or logs.

### Status model

- **OPERATIVE** — recent evidence proves the API/data path actually worked.
- **CONNECTED** — the application/runtime has a persisted connected integration, but no fresh provider API success was proven in this inventory pass.
- **CONFIGURED** — GitHub/Supabase wiring and credential names are present, but effective provider permission has not been freshly proven.
- **DEPLOYED_NO_TRAFFIC** — runtime code is deployed and active, but there is no delivery/use evidence yet.
- **CODE_ONLY** — code/reference exists; this is not proof of provider account access.
- **BLOCKED_EXTERNAL** — a secondary connection/identity exists but an external subscription/auth boundary blocks useful reads.
- **AGENT_CAPABILITY_UNVERIFIED** — a local agent reports a capability, but this inventory did not verify a corresponding NUVANX credential/access path.

## Verified access matrix

| Google surface | Canonical owner / repo | Authentication / configuration path | Current status | Evidence and interpretation |
| --- | --- | --- | --- | --- |
| Google Search Console — URL Inspection for `https://nuvanx.com/` | `nuvanx-siteground` → `.github/workflows/production.yml` | Preferred: GitHub OIDC/WIF via `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SEARCH_CONSOLE_SERVICE_ACCOUNT`; fallback: `SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON` | **OPERATIVE (historically proven), current wiring intact** | PR #454 was merged after an empirical URL Inspection run returning 61/63 indexed URLs. Current Production still authenticates with WIF/ADC first, JSON service-account fallback second, runs `scripts/seo/index-pages.js`, and requires `INSPECTION_COMPLETED=true`, inventory parity and `API_ERRORS=0`. A fresh run should be used whenever current GSC state is required. |
| Google Search Console — Search Analytics performance data | `nuvanx-siteground` → `scripts/seo/gsc-client.js` / `gsc-full-analysis.js` | Application Default Credentials compatible with the same Google auth model; client requests `webmasters.readonly` and calls `searchanalytics.query()` | **CONFIGURED / fresh query proof required** | Direct first-party Search Analytics code exists for queries/pages/devices/countries and dynamic settled date windows, but the canonical Production workflow currently executes URL Inspection rather than `gsc-full-analysis.js`. Do not treat #801 as solved until a fresh Search Analytics query succeeds and a reproducible baseline is exported. Wizard/Supermetrics are not the preferred path. |
| Google Sheets — Doctoralia appointments | `Nuvanx-System` → `scripts/sync-doctoralia-appointments.js` / Daily Sync | `GOOGLE_DOCTORALIA_SERVICE_ACCOUNT` (preferred in workflow); supported fallbacks in code: `GOOGLE_SA_JSON`, credential file, explicit service-account fields or API key. Sheet identity via `DOCTORALIA_APPOINTMENTS_SHEET_ID` / `DOCTORALIA_SHEET_ID` | **OPERATIVE** | Code uses `spreadsheets.readonly`. Production DB contained 1,924 ingested appointment rows, sheet rows 2–1925, with `last_imported_at=2026-08-24 07:26:30+00`, proving a current successful Sheets-backed sync above the enforced 1,800-row minimum. |
| Google Business Profile API — NUVANX clinics | `Nuvanx-System` local-SEO governance | Provider credential owner not yet mapped to a named GitHub Action secret in this inventory. Canonical public resource: account `accounts/101783512211091393233` | **OPERATIVE for profile identity/category reads on 2026-08-24** | `docs/local-seo/gbp-profiles.json` records Chamberí and Goya with `primary_category_status=confirmed_via_gbp_api_2026-08-24`, stable Place IDs, review URLs and phone/category snapshots. This proves an effective GBP API read occurred. It does **not** prove every administrative field or mutation scope is available. Credential provenance must still be mapped before automating writes. |
| Google Ads — NUVANX integration record | `Nuvanx-System` / Supabase production | GitHub secrets include `GOOGLE_ADS_SERVICE_ACCOUNT`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`; Supabase also stores one `credentials` record and one `integrations` record for service `google_ads` | **CONNECTED** | Supabase `integrations.service='google_ads'` is `connected` and has customer ID metadata; one Google Ads credential record exists. This is application-level connection evidence, not a fresh GAQL success. |
| Google Ads — direct read-only GAQL diagnostic | `nuvanx-siteground` → `scripts/seo/google-ads-list-campaigns.js` | OAuth client ID/secret + refresh token + developer token + customer ID; optional login customer ID. Values supplied privately, never committed | **CONFIGURED / fresh API proof required** | Historical audit tooling exists and issues a bounded read-only GAQL campaign query. An earlier audit recorded `invalid_client`; subsequent credential-loading fixes were merged. This inventory did not obtain a fresh `GOOGLE_ADS_READ_ONLY=PASS`, so do not label the API path operative until the probe is rerun with current credentials. |
| Google Data Manager → Google Ads conversion ingestion | `Nuvanx-System` → Supabase `google-data-manager-export` | Runtime expects `GOOGLE_DATA_MANAGER_CLIENT_ID`, `GOOGLE_DATA_MANAGER_CLIENT_SECRET`, `GOOGLE_DATA_MANAGER_REFRESH_TOKEN`, optional project/customer/login-customer IDs and `GOOGLE_DATA_MANAGER_CONVERSION_ACTIONS_JSON` | **DEPLOYED_NO_TRAFFIC** | Edge Function `google-data-manager-export` is ACTIVE in production, version 7. It targets Google Data Manager `events:ingest` / `requestStatus:retrieve` using `datamanager` OAuth scope and supports gclid/gbraid/wbraid plus hashed user identifiers. The `google_data_manager_outbox` was empty during this verification, so no delivery claim is made. |
| Google click attribution storage / lineage | `Nuvanx-System` → Supabase `google-click-attribution` + migrations | No Google provider credential required for storage itself; receives click identifiers from NUVANX web attribution flow | **OPERATIVE RUNTIME, not a Google API access** | Edge Function `google-click-attribution` is ACTIVE in production, version 9. Migrations cover click store, submission idempotency and NUVANX lead lineage. Treat this as internal attribution infrastructure, not evidence of Google Ads API permission. |
| Google PageSpeed Insights API | `nuvanx-siteground` → `scripts/seo/pagespeed-cwv-analysis.js` | `GOOGLE_PAGESPEED_API_KEY` or `PAGESPEED_API_KEY` | **CODE_ONLY / GitHub credential presence not verified** | The manual diagnostic calls PageSpeed Online v5 and redacts the API key from errors. No canonical workflow reference to either key was verified in this pass. Production performance uses standalone Lighthouse and therefore does not depend on this API credential. |
| Google Drive — Doctoralia identifier | `Nuvanx-System` Daily Sync | `DOCTORALIA_DRIVE_FILE_ID` | **CONFIGURED AS IDENTIFIER, not verified Drive API access** | Current validator requires the Drive file ID to match the Sheet ID, and the appointments sync uses the Sheets API. Do not infer Drive API permissions from this variable name. |
| Looker / Looker Studio folder reference | `Nuvanx-System` Daily Sync environment | `DOCTORALIA_LOOKER_FOLDER_ID` | **CONFIGURED / no consumer verified** | The secret is injected by the workflow, but no active Looker API consumer was verified in the current repository tree during this pass. Keep as a stored reference until a concrete consumer or API probe is established. |
| Google Tag Manager publisher | `nuvanx-siteground` → `scripts/seo/setup-gtm-conversion-trigger.js` | Private local OAuth: `GTM_REFRESH_TOKEN`, `GTM_CLIENT_ID`, `GTM_CLIENT_SECRET` (or corresponding Ads OAuth pair), `GTM_ACCOUNT_ID`, `GTM_CONTAINER_ID`, conversion ID/label | **CODE_ONLY / GitHub credential presence not established** | The repository intentionally describes this as a manual private-TTY publisher and refuses automated CI mutation. Do not assume GitHub Actions holds these GTM credentials unless separately verified. |
| Google Business Profile via Supermetrics | Secondary/external discovery path | Connection visible for `nuvanx@gmail.com` | **BLOCKED_EXTERNAL secondary path** | Supermetrics account discovery exposed both NUVANX locations, but data queries are blocked because the Supermetrics subscription expired 2026-06-20. Direct GBP API evidence now exists separately in `Nuvanx-System`; Supermetrics is no longer the authoritative access path. |
| Google Business Profile review-request WordPress code | Local/Nuvanx-System workspace MU plugins | `nuvanx-google-review-request.php` / `-v2.php` | **CODE + governed profile identifiers** | Review links now default to the API-confirmed Place IDs for Chamberí and Goya. This is site behavior, not proof of GBP mutation permissions. |
| Google Maps coordinates / GEO schema bridge | Local/Nuvanx-System workspace MU plugin | `zzzzzzzzzz-nuvanx-phase4d-geo-entity-bridge.php` | **CODE_ONLY** | Schema/coordinate references are site data, not proof of Google Maps Platform credential access. |
| Google Analytics / GA4 | No GitHub credential owner verified in this pass | — | **NOT VERIFIED** | No GitHub-held GA4 property/auth path was established during this inventory pass. Do not infer GA4 access from generic Google service accounts or from Supermetrics source discovery. |

## Canonical GBP resource identifiers

These identifiers are non-secret and are intentionally tracked for entity consistency:

- GBP account resource: `accounts/101783512211091393233`
- Chamberí Place ID: `ChIJ6R9LvsQpQg0Rj9Ioei_Xwsg`
- Goya Place ID: `ChIJlZAA78cpQg0RXFxu-B2lgQI`

Current profile snapshots live in `docs/local-seo/gbp-profiles.json`; that file is the owner for profile identity/category truth captured from the 2026-08-24 GBP API read.

## Google-related GitHub credential names currently governed

### `NUVANX-Medicina-Estetica-Laser/nuvanx-siteground`

Variables / secrets used by the canonical Production workflow:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SEARCH_CONSOLE_SERVICE_ACCOUNT`
- `SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON` — fallback only

The Search Console property is repository configuration: `https://nuvanx.com/`.

The repository also contains manual Google Ads/GTM/PageSpeed tooling, but its private credential bundles are intentionally not part of an automatic canonical workflow unless separately documented.

### `Arisofia/Nuvanx-System`

GitHub Actions currently references these Google-related logical values:

- `GOOGLE_ADS_SERVICE_ACCOUNT`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_DOCTORALIA_SERVICE_ACCOUNT`
- `DOCTORALIA_SHEET_ID`
- `DOCTORALIA_APPOINTMENTS_SHEET_ID`
- `DOCTORALIA_DRIVE_FILE_ID`
- `DOCTORALIA_LOOKER_FOLDER_ID`

Runtime code for Google Data Manager additionally expects Supabase runtime secrets/configuration named:

- `GOOGLE_DATA_MANAGER_CLIENT_ID`
- `GOOGLE_DATA_MANAGER_CLIENT_SECRET`
- `GOOGLE_DATA_MANAGER_REFRESH_TOKEN`
- `GOOGLE_DATA_MANAGER_PROJECT_ID`
- `GOOGLE_DATA_MANAGER_CUSTOMER_ID`
- `GOOGLE_DATA_MANAGER_LOGIN_CUSTOMER_ID`
- `GOOGLE_DATA_MANAGER_CONVERSION_ACTIONS_JSON`

**Never record their values here.**

## Local-agent capabilities that are not credential proof

A local agent reported access/capabilities for GCP Cloud SQL, Logging, Monitoring, Pub/Sub, Resource Manager, Compute Engine, Google Maps code assistance, Google Ads optimization and Google developer knowledge. These are useful agent/tool capabilities but were **not** validated in this inventory as NUVANX account credentials held in GitHub.

Until a concrete NUVANX project/account plus a successful safe read is verified, record these as **AGENT_CAPABILITY_UNVERIFIED**, not as production access.

## Current Staging incident is not a Google credential incident

Staging run `32762360706` for siteground SHA `75206670d254b640674d5c959b7c84a0e426c39a` successfully authenticated over SiteGround SSH, created rollback evidence, deployed the exact SHA, completed migrations and passed sitemap manifest coverage. It failed later in `verify-staging-boundary.mjs` because the public edge returned HTTP 202 / AntiBot behavior, robots exposed `noindex` instead of the expected `noindex,nofollow`, and the deployment SHA meta was missing. Rollback completed successfully.

Do not use that Staging failure as evidence that Google credentials are broken.

## Refresh procedure

When a future task needs Google data, prefer these paths in order:

1. **Search Console URL Inspection:** canonical `production.yml` post-audit using GitHub WIF/ADC. Use fresh artifacts; do not use GSC Wizard as the source of truth.
2. **Search Console Search Analytics:** run `gsc-full-analysis.js` under the same trusted ADC/WIF identity and require a successful `searchanalytics.query()` before using query/page metrics for prioritization.
3. **Google Business Profile:** use the direct GBP API path that produced `docs/local-seo/gbp-profiles.json`; before any write, first map the concrete credential owner/scope. Use the tracked account/Place IDs for identity consistency.
4. **Doctoralia Sheets:** Nuvanx-System Daily Sync/service account. Confirm current row count and `last_imported_at` before relying on the dataset.
5. **Google Ads read:** run the bounded read-only GAQL diagnostic with current private credentials and require an explicit success marker before treating Ads API as operative.
6. **Google Data Manager:** verify non-empty outbox, successful provider request IDs and final delivery status before claiming enhanced conversions are flowing.
7. **GTM:** preserve manual-publisher safety; verify live container/version and end-to-end conversion behavior after any deliberate publish.
8. **Supermetrics:** treat only as a secondary discovery path while its subscription remains expired.

Any future validation should update the `Last verified` date and the relevant status/evidence row without exposing credentials.