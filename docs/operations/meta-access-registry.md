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
| Pixel / Dataset | `NUVANX | Web | CAPI | RSV26` | Name previously confirmed in Business Settings; numeric ID remains to be independently recorded before treating it as canonical |

### System User identity reconciliation

A prior Business Settings screen showed `61593654929650` for the user labelled **Conversions API System User**. Production audit `32763162619` subsequently queried the current Business system-user inventory directly and found only:

- `122096106543457614` — `jenineferderas` — `ADMIN`.
- `122098243371455164` — `Conversions API System User` — `EMPLOYEE`.

`/debug_token` resolves the canonical Production token to `122098243371455164`, and that ID is present in the Business inventory. `61593654929650` is **not present** in the current Graph inventory and must not be used as the canonical runtime System User unless it is independently re-established by a later Meta audit.

## Secret-variable ownership

These are variable names only. Values belong in managed secret stores and must never be committed or pasted into documentation/logs.

| Variable | Purpose | Current contract |
| --- | --- | --- |
| `META_CANONICAL_ACCESS_TOKEN` | Canonical Meta management/runtime token | Must belong to App `1836302544001572` and System User `122098243371455164`; management scope validated |
| `META_ADS_MANAGEMENT_TOKEN` | Supported explicit management-token alias for Meta audit/apply scripts | When set, RSV26 management tooling gives this variable precedence over `META_CANONICAL_ACCESS_TOKEN`; provision/rotate it only when intentionally using the separate alias |
| `META_CANONICAL_APP_SECRET` | Preferred App Secret for `NUVANX Reporting` | Used for `appsecret_proof`, token debugging, webhook/app separation |
| `META_REPORTING_APP_SECRET` | Supported reporting/canonical App Secret fallback | `api` and `daily-aggregates` fall back to this variable when `META_CANONICAL_APP_SECRET` is unset; include it in secret-store maintenance/rotation while the fallback remains supported |
| `META_APP_SECRET` | Legacy Meta stack App Secret | Keep separate; do not overwrite with canonical secret |
| `META_REPORTING_TOKEN_60D` | Read-oriented/reporting compatibility token | Not the canonical write credential |

## Granted scopes verified on the canonical token

Verified in Production read-only audit `32761212623`:

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

Not granted / still pending for the displayed Meta use cases:

- `ads_mcp_management` — Ads Agent case remains pending.
- fundraiser/charitable management scope — Fundraisers case not configured and not currently applicable.

## Asset/capability verification

| Surface | Verified capability | State |
| --- | --- | --- |
| Marketing API / Ads | Read campaign/ad sets/ads/creatives; write existing campaign/ad objects; create paused ad using existing `creative_id` | PASS |
| Marketing Insights | Campaign insights read | PASS |
| Lead Ads | Active form read and `/{form}/leads` real read | PASS |
| Page | Basic read; canonical Page Access Token derivation; `/subscribed_apps` with Page token | PASS |
| Messenger | `/conversations` with Page Access Token | PASS; zero rows at audit time |
| Instagram account/content | Account read and content-related scopes | PASS |
| Instagram messaging | `/conversations` with Page Access Token | PENDING — Meta returns `code=3`, app lacks capability despite scope |
| WhatsApp | 2 owned WABAs readable; both phone-number reads succeed; message-template reads succeed | PASS for management/read; outbound production message not tested |
| Catalog API | `catalog_management` and owned-catalog endpoint | PASS; zero owned catalogs at audit time |
| Live Video | `/live_videos` read; posting/video scopes present | PASS for read; no broadcast created solely for testing |
| Threads | `threads_business_basic` granted | PENDING — requires Threads user authorization/token flow |
| Meta Ads Agent | No `ads_mcp_management` | PENDING |
| Facebook Login for Business | System-user business access works | PENDING — interactive OAuth not configured/tested |
| oEmbed | Runtime probes not certified | PENDING — resolve separately before claiming support |
| App Ads | No mobile app/store/App Events asset in canonical stack | NOT APPLICABLE CURRENTLY |
| Audience Network | No publisher/mobile monetization property | NOT APPLICABLE CURRENTLY |
| Fundraisers | No relevant scope/use case; tested legacy Page edge unavailable | NOT APPLICABLE CURRENTLY |

## Publication metadata

Production audit `32762760660` after the App Domain update confirmed:

- App ID `1836302544001572` / `NUVANX Reporting`.
- `app_domains = ["nuvanx.com"]`.
- Privacy Policy URL present.
- Terms of Service URL present.
- Contact email present.
- Namespace absent.
- Deauthorization callback absent.
- User-support email absent.
- User-support URL absent.
- Website URL absent.

On 2026-08-24, the Meta App Dashboard Basic Settings UI was saved with **User Data Deletion → Data deletion instructions URL** set to `https://nuvanx.com/politica-privacidad/`.

A dedicated public WordPress page was then published as page `3631` at `https://nuvanx.com/eliminacion-datos-meta/`. It provides Meta-specific deletion instructions: request steps, covered Meta-originated interactions, the `info@nuvanx.com` contact channel, identity details needed to locate the request, prohibited credential/clinical oversharing, expected confirmation/resolution, and lawful-retention caveats. The Dashboard must be updated to this dedicated URL before the App Review submission is finalized; until that UI save occurs, the previously saved privacy-policy URL remains the Dashboard-confirmed value.

Read-only audit `32768146699` / job `97562196706` queried `GET https://graph.facebook.com/v22.0/1836302544001572` with each of the tested `fields` values `data_deletion_url`, `data_deletion_callback_url`, `status`, `app_mode`, `is_live`, and `mode`. Those tested queries returned HTTP 400 / Graph `code=100` with no `error_subcode` in the captured log; the fields were therefore **not returned by the tested Graph v22 queries**. The audit separately confirmed that `app_domains`, `privacy_policy_url`, and `terms_of_service_url` are returned. Do not generalize this result into a claim that Meta exposes no supported publication/deletion surface elsewhere; the Dashboard/UI remains the evidence source for the saved deletion URL and Development/Live state.

The absence of the optional/support fields above must not be interpreted as a publication blocker without checking the current Meta App Dashboard requirement for the specific enabled use cases.

## App Review / business verification state

On 2026-08-24, App Review submission `1836338617331298` showed the business-verification step for **NUVANX Medicina Estética Láser** as **En revisión**. The Dashboard states that Meta will update the verification status after review and estimates approximately two business days. This is a current external review state, not a repository or credential failure.

The App Review request is still **No enviada** and currently contains a broad permission/feature set. Do not submit it unchanged merely to unblock RSV26: permissions without a real, reproducible user experience should be removed or left for a later review rather than justified with hypothetical use.

## Current RSV26 publication blocker

The canonical app can read and manage existing ad objects, but creation of a **new ad creative** is currently rejected by Meta with `code=100 / subcode=1885183` while the app remains in Development mode. Three creation paths were tested:

1. `POST /adcreatives` — blocked with `1885183`.
2. `POST /ads` with an inline new creative — blocked with `1885183`.
3. `POST /ads` using an existing `creative_id` — works, but the account has no existing creative matching the four final RSV26 copy contracts exactly.

Therefore the final RSV26 migration remains pending App publication/required access. Do not report the live campaign copy or attribution as reconciled until a post-publication apply and zero-drift audit pass.

## Evidence runs

- `32761212623` — full Meta app use-case read-only audit.
- `32761521018` — Page-token / Messenger / Instagram / WhatsApp detail audit.
- `32762760660` — publication metadata/App Domain audit after adding `nuvanx.com`.
- `32763162619` — current Business System User inventory + token identity reconciliation.
- `32768146699` / job `97562196706` — App object Graph v22 field probes; tested deletion/app-mode fields returned Graph `code=100` and were not returned by those queries.
- 2026-08-24 Dashboard save confirmation — User Data Deletion instructions URL saved as `https://nuvanx.com/politica-privacidad/`.
- WordPress page `3631` — dedicated replacement instructions published at `https://nuvanx.com/eliminacion-datos-meta/`; Dashboard URL switch still pending.
- App Review submission `1836338617331298` — business verification shown as **En revisión**; App Review request itself still **No enviada**.

Temporary audit PRs must be closed without merge after evidence capture. Permanent operational knowledge belongs in this document and canonical config/tests, not in one-shot workflows.
