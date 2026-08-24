# Meta canonical access registry

Last verified: 2026-08-24

This document is the non-secret operational registry for the canonical NUVANX Meta stack. It records identifiers, granted access, tested capabilities, known gaps, and the names of secret variables. **Never commit access-token or App Secret values here.**

## Canonical identity

| Resource | Canonical value | Verified state |
| --- | --- | --- |
| Business Portfolio | `897835716596010` | Canonical business |
| Meta App | `NUVANX Reporting` | Canonical app |
| App ID | `1836302544001572` | Token/app match verified |
| System User | `122098243371455164` | `Conversions API System User` · `EMPLOYEE`; token identity and Business membership verified |
| Business admin system user | `122096106543457614` | `jenineferderas` · `ADMIN`; present in current Business system-user inventory |
| Ad Account | `act_718120894191565` | Active · EUR · `Europe/Madrid` |
| RSV26 Campaign | `120249780276630419` | `RSV26/Valoración gratuita/Meta/Madrid` |
| Facebook Page | `1329458703573874` | Accessible; Page Access Token derivation verified |
| Instagram business user | `17841474094610850` | `nuvanx_`; account read verified |
| Lead form | `1493697602775666` | Active; lead retrieval verified |
| App Domain | `nuvanx.com` | Verified via Graph on 2026-08-24 |
| Pixel / Dataset | `1037346649192028` · `NUVANX | Web | CAPI | RSV26` | Canonical ID/name pair verified independently via Business `/owned_pixels` and Ad Account `/adspixels` |

### System User identity reconciliation

A prior Business Settings screen showed `61593654929650` for the user labelled **Conversions API System User**. Production audit `32763162619` subsequently queried the current Business system-user inventory directly and found only:

- `122096106543457614` — `jenineferderas` — `ADMIN`.
- `122098243371455164` — `Conversions API System User` — `EMPLOYEE`.

`/debug_token` resolves the canonical Production token to `122098243371455164`, and that ID is present in the Business inventory. `61593654929650` is **not present** in the current Graph inventory and is non-canonical historical metadata.

## Secret-variable ownership

These are variable names only. Values belong in managed secret stores and must never be committed or pasted into documentation/logs.

| Variable | Purpose | Current contract |
| --- | --- | --- |
| `META_CANONICAL_ACCESS_TOKEN` | Canonical Meta management/runtime token | Must belong to App `1836302544001572` and System User `122098243371455164`; management scope validated |
| `META_ADS_MANAGEMENT_TOKEN` | Supported explicit management-token alias for Meta audit/apply scripts | When set, RSV26 management tooling gives this variable precedence over `META_CANONICAL_ACCESS_TOKEN` |
| `META_CANONICAL_APP_SECRET` | Preferred App Secret for `NUVANX Reporting` | Used for `appsecret_proof`, token debugging, webhook/app separation |
| `META_REPORTING_APP_SECRET` | Supported reporting/canonical App Secret fallback | `api` and `daily-aggregates` fall back to this variable when `META_CANONICAL_APP_SECRET` is unset |
| `META_APP_SECRET` | Legacy Meta stack App Secret | Keep separate; do not overwrite with canonical secret |
| `META_REPORTING_TOKEN_60D` | Read-oriented/reporting compatibility token | Not the canonical write credential |

## Granted scopes verified on the canonical token

Production audits confirm a broader set of scopes on the canonical token than are being requested in the first App Review. Token grants and App Review scope are deliberately tracked separately.

Verified token scopes include:

- `ads_management`
- `ads_read`
- `business_management`
- `catalog_management`
- `facebook_branded_content_ads_brand`
- `instagram_basic`
- `instagram_branded_content_ads_brand`
- `instagram_branded_content_brand`
- `instagram_content_publish`
- `instagram_manage_comments`
- `instagram_manage_contents`
- `instagram_manage_insights`
- `instagram_manage_messages`
- `instagram_shopping_tag_products`
- `leads_retrieval`
- `manage_app_solution`
- `pages_manage_ads`
- `pages_manage_engagement`
- `pages_manage_metadata`
- `pages_manage_posts`
- `pages_messaging`
- `pages_read_engagement`
- `pages_read_user_content`
- `pages_show_list`
- `pages_utility_messaging`
- `paid_marketing_messages`
- `public_profile`
- `publish_video`
- `read_insights`
- `threads_business_basic`
- `whatsapp_business_manage_events`
- `whatsapp_business_management`
- `whatsapp_business_messaging`

Not granted / still pending for displayed Meta use cases:

- `ads_mcp_management` — Ads Agent case remains pending.
- fundraiser/charitable management scope — not configured and not currently applicable.

## First App Review scope

Submission `1836338617331298` uses a **server-to-server / Meta Business System User** reviewer model. The intended first-review scope is exactly:

1. Marketing API Access Tier
2. `ads_management`
3. `ads_read`
4. `business_management`
5. `pages_show_list`
6. `pages_read_engagement`
7. `pages_manage_ads`
8. `leads_retrieval`

Everything else is deferred from the first review, including `pages_manage_metadata`, messaging, catalog, Threads, oEmbed, Live Video, WhatsApp and Ads Agent permissions/features unless a later product requirement independently justifies them.

## Asset/capability verification

| Surface | Verified capability | State |
| --- | --- | --- |
| Marketing API / Ads | Read campaign/ad sets/ads/creatives; write existing campaign/ad objects; create paused ad using existing `creative_id` | PASS |
| Marketing Insights | Campaign insights read | PASS |
| Lead Ads | Active form read and `/{form}/leads` real read | PASS |
| Page | Basic read; canonical Page Access Token derivation; `/subscribed_apps` with Page token | PASS |
| Messenger | `/conversations` with Page Access Token | PASS; zero rows at audit time, not part of first review |
| Instagram account/content | Account read and content-related scopes | PASS; not part of first review |
| Instagram messaging | `/conversations` with Page Access Token | PENDING — Meta returns `code=3`; not part of first review |
| WhatsApp | Owned WABAs/read paths verified | PASS for management/read; not part of first review |
| Catalog API | `catalog_management` and owned-catalog endpoint | PASS; not part of first review |
| Live Video | `/live_videos` read | PASS for read; not part of first review |
| Threads | `threads_business_basic` granted | PENDING; not part of first review |
| Meta Ads Agent | No `ads_mcp_management` | PENDING; not part of first review |

## Publication metadata

Production audit `32762760660` after the App Domain update confirmed:

- App ID `1836302544001572` / `NUVANX Reporting`.
- `app_domains = ["nuvanx.com"]`.
- Privacy Policy URL present.
- Terms of Service URL present.
- Contact email present.

A dedicated public Meta deletion-instructions page exists at:

- `https://nuvanx.com/eliminacion-datos-meta/`

Historical Dashboard evidence had previously saved the privacy-policy URL in the User Data Deletion field. The dedicated deletion page is the canonical target. Dashboard/UI state remains authoritative for confirming the final saved value because the tested Graph v22 app-object fields did not expose deletion/app-mode state in audit `32768146699` / job `97562196706`.

## App Review / business verification state

On 2026-08-24, submission `1836338617331298` showed Business Portfolio `897835716596010` as **En revisión** for Business Verification.

The operator subsequently reported in the Meta UI that **Business Verification is the only remaining publication blocker**. This operator/UI report is not independently readable through the repository or Graph probes, so it must remain distinguished from API-verified facts.

After Business Verification completes, verify whether Meta actually requires **Access Verification / Technology Provider verification** for this first-party NUVANX-only asset model before making any such declaration. Do not describe NUVANX as a technology provider for third-party businesses unless the product model actually changes.

## Application-layer Meta integration state

A direct Production Supabase inspection on 2026-08-24 confirmed two distinct integration layers for the primary application user:

- legacy `service=meta`: `connected`, pointing to historical ad accounts `act_9523446201036125` and `act_4172099716404860`, with a stored encrypted per-user credential;
- canonical `service=meta_ads`: App `1836302544001572`, Business `897835716596010`, Ad Account `act_718120894191565`, Page `1329458703573874`.

The canonical `meta_ads` row was reconciled in Production on 2026-08-24 so both `systemUserId` metadata forms now use `122098243371455164`. The stale `61593654929650` value was removed from that canonical row.

The canonical row intentionally remains:

- `status=disconnected`;
- `credential_state=missing_management_token`.

This is accurate. A credentials-table inventory found **two encrypted `service=meta` credentials and zero `service=meta_ads` credentials**. Both existing `meta` credentials are tagged to the historical account pair. No credential was copied, relabelled or fabricated during cleanup.

The current `resolveMetaCreds()` application path still reads a per-user `service=meta` credential and `service=meta` integration metadata. Therefore the internal frontend must **not** be treated as canonical for `act_718120894191565` until a canonical credential is provisioned and the resolver is explicitly wired/tested for `meta_ads`. This application-layer gap does not invalidate the independently verified server-to-server System User App Review path.

## Current RSV26 publication blocker

The canonical app can read and manage existing ad objects, but creation of a **new ad creative** was rejected while the app remained in Development mode with `code=100 / subcode=1885183`:

1. `POST /adcreatives` — blocked with `1885183`.
2. `POST /ads` with an inline new creative — blocked with `1885183`.
3. `POST /ads` using an existing `creative_id` — works, but no existing creative matches all final RSV26 copy contracts exactly.

Therefore final RSV26 creative reconciliation must wait until publication/access is cleared and a post-publication creation probe succeeds.

PR `#267` was closed without merge on 2026-08-24. Its implementation was superseded because it pinned a stale trusted SHA and allowed a production apply path to be retriggered through PR ready-for-review transitions. Any replacement must execute from trusted `main`, use an explicit protected dispatch, require production approval, persist a one-shot claim, and perform zero-drift post-validation.

## Evidence runs

- `32761212623` — full Meta app use-case read-only audit.
- `32761521018` — Page-token / Messenger / Instagram / WhatsApp detail audit.
- `32762760660` — publication metadata/App Domain audit after adding `nuvanx.com`.
- `32763162619` — current Business System User inventory + token identity reconciliation.
- `32768146699` / job `97562196706` — App object Graph v22 field probes.
- `32773483796` / job `97579047819` — App Review core-call audit: `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `leads_retrieval` and Marketing API read all PASS.
- `32779652968` / job `97598665896` — canonical Pixel/Dataset read-only audit: Business `/owned_pixels` and Ad Account `/adspixels` each returned the unique object `1037346649192028` / `NUVANX | Web | CAPI | RSV26`; PASS.
- App Review submission `1836338617331298` — Business Verification shown as **En revisión** on 2026-08-24.

Temporary audit PRs must be closed without merge after evidence capture. Permanent operational knowledge belongs in this document and canonical config/tests, not in disposable one-shot workflows.
