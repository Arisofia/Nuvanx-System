# Meta App Review — exact form copy

Submission: `1836338617331298`
App: `NUVANX Reporting` (`1836302544001572`)
Business: `897835716596010`
Prepared: 2026-08-24

This file contains non-secret text prepared for the Meta App Review UI. Reviewer passwords, access tokens and App Secrets must never be committed.

## Core positioning used consistently throughout the submission

**Short description**

NUVANX Reporting is an internal hybrid business application for NUVANX Medicina Estética Láser. Its authenticated web interface is used for Meta Ads reporting and Lead Ads/CRM workflows. Meta Ads management operations are executed server-to-server from the backend with a System User token belonging to the NUVANX Business Portfolio. The application accesses only NUVANX-owned business assets in this first review.

**Important reviewer note**

This app uses a Meta Business System User token for server-to-server Marketing API operations. Therefore, there is no frontend Facebook Login flow for the `ads_management` server-side operation. The web login is the application's own Supabase email/password authentication. The submission screencast for `ads_management` must show the real server-side operation and the resulting Meta object state.

## Reviewer website

`https://frontend-arisofias-projects-c2217452.vercel.app/`

## Reviewer credentials

Email: **PENDING — dedicated reviewer account**

Password: **PENDING — Meta reviewer credential field only; never commit**

No dedicated Meta/reviewer production account existed when this dossier was prepared.

## Reviewer instructions — paste-ready draft

> NUVANX Reporting es una aplicación interna híbrida utilizada por NUVANX Medicina Estética Láser. La interfaz web autenticada se utiliza para consultar campañas y anuncios de Meta y para trabajar con los leads procedentes de Meta Lead Ads. Las operaciones de gestión de anuncios se ejecutan server-to-server desde el backend mediante un System User del Business Portfolio de NUVANX; por ese motivo no existe un flujo visible de Facebook Login para esas llamadas de Marketing API.
>
> ACCESO WEB
> 1. Abra https://frontend-arisofias-projects-c2217452.vercel.app/.
> 2. Introduzca el correo y la contraseña de la cuenta de revisión proporcionados en esta solicitud.
> 3. Pulse “Entrar”. La aplicación redirige a “Centro de control” (/dashboard).
> 4. Abra “Marketing” y seleccione “Meta Ads”.
> 5. En “Campañas” puede consultar las campañas de la cuenta Meta de NUVANX y sus datos de rendimiento: estado, objetivo, presupuesto, gasto, impresiones, alcance, clics, CTR, CPC, CPM y conversiones.
> 6. Abra “Por anuncio” para consultar los anuncios y sus métricas.
> 7. Abra “CRM” para revisar los leads procedentes de Meta Lead Ads y su contexto de atribución.
>
> OPERACIONES SERVER-TO-SERVER
> 8. Para `ads_management`, esta app utiliza un Meta Business System User token en el backend y no un Facebook Login visible en el frontend. Consulte el screencast adjunto: muestra la validación del System User contra la app NUVANX Reporting, el acceso a la cuenta publicitaria NUVANX, una operación real de gestión limitada a un activo publicitario propiedad de NUVANX en estado seguro/PAUSED y la relectura del objeto resultante desde Meta. La prueba no requiere activos personales del revisor y no debe activar gasto publicitario inesperado.
>
> ACTIVOS DE PRUEBA NUVANX
> - Business Portfolio: 897835716596010
> - Meta App: NUVANX Reporting
> - App ID: 1836302544001572
> - Ad Account: act_718120894191565
> - Facebook Page: 1329458703573874
> - Lead Form: 1493697602775666
> - Campaign: 120249780276630419
>
> Todas las pruebas deben realizarse únicamente con activos comerciales de NUVANX. No se necesitan activos personales del revisor.

Do not submit the draft until the reviewer account exists and the `ads_management` screencast corresponds to an actual test executed on the current production/canonical stack.

# Permission / feature answers

## Marketing API Access Tier

### Why do you need this feature?

> NUVANX Reporting uses the Meta Marketing API as the control plane for NUVANX-owned advertising assets. Authenticated NUVANX users use the web application to monitor campaign/ad performance, while controlled ad-management operations run server-to-server from the backend using the canonical NUVANX Business System User token. The application is used for NUVANX's own Business Portfolio and advertising account in this first review.

### How does the app use it?

> The application reads the NUVANX ad account, campaigns, ads, creatives and insights for reporting. The backend also performs controlled management operations against NUVANX-owned ad objects using `ads_management`. The Marketing API is not used as the Conversions API measurement pipeline; those two technical planes are kept separate.

### Reviewer evidence

> Web: Login → Marketing → Meta Ads → Campañas / Por anuncio. Server-to-server: attached `ads_management` screencast showing the System User authenticated backend operation and the resulting Meta state.

## `ads_read`

### Why do you need this permission?

> NUVANX Reporting needs `ads_read` to retrieve advertising objects and performance metrics for the NUVANX Meta ad account and display them to authenticated NUVANX users in the internal Marketing dashboard.

### How is the data used?

> The app displays NUVANX campaign/ad identifiers and names, status, objective, budget and reporting metrics including spend, impressions, reach, clicks, CTR, CPC, CPM and conversions. The data is used for internal performance monitoring and decision support.

### Reviewer path

> Login → Marketing → Meta Ads → Campañas. Then open “Por anuncio”. The reviewer will see data retrieved from the NUVANX ad account `act_718120894191565`.

### Technical evidence

> Production App Review core-call run `32773483796` recorded `APP_REVIEW_ads_read=PASS` and `APP_REVIEW_marketing_api_read=PASS`.

## `ads_management`

### Why do you need this permission?

> NUVANX uses server-to-server automation to manage advertising objects belonging to its own Meta ad account. The backend requires `ads_management` for controlled create/update operations on campaigns, ad sets, ads and creatives used by NUVANX. The canonical management workflow validates that the access token belongs to App `1836302544001572`, contains `ads_management`, and resolves to the approved NUVANX System User before any write is allowed.

### Important authentication explanation

> This is a server-to-server/System User token use case. There is no frontend Meta Login authentication flow for the management calls. The end user signs into the NUVANX web application with the application's own authentication, while Meta Marketing API management calls are made from the backend using the NUVANX Business System User token.

### Existing real capability

> The production stack has successfully managed existing NUVANX ad objects and has successfully created a PAUSED ad by referencing an existing `creative_id`. New creative creation is currently restricted while the app remains in Development mode, so the review demonstration must use a management action that is valid in the current app state and does not create unintended spend.

### Screencast contract

The recording must show, without exposing secrets:

1. The NUVANX Reporting application/context.
2. That the operation is server-to-server using the NUVANX System User, not a frontend Facebook Login flow.
3. The target asset belongs to NUVANX.
4. A real bounded `ads_management` mutation in a safe state such as PAUSED/no-spend.
5. The successful Meta response/object ID or state.
6. A re-read of the Meta object confirming the result.
7. Cleanup/rollback where applicable.

Do not show access-token or App Secret values.

## `business_management`

### Why do you need this permission?

> NUVANX Reporting uses `business_management` to resolve and validate the NUVANX Business Portfolio context and the business assets assigned to the canonical NUVANX System User. This ensures that Marketing API operations are bound to the NUVANX business and its owned advertising assets.

### Assets

> Business Portfolio `897835716596010`; System User `122098243371455164`; Ad Account `act_718120894191565`.

### Evidence

> Production App Review core-call run `32773483796` recorded `APP_REVIEW_business_management=PASS`.

## `pages_show_list`

### Why do you need this permission?

> The application needs to identify and validate the NUVANX Facebook Page associated with the business's Lead Ads workflow and Page-scoped advertising context.

### Page

> `1329458703573874`.

### Evidence

> Production App Review core-call run `32773483796` recorded `APP_REVIEW_pages_show_list=PASS`.

## `pages_read_engagement`

### Why do you need this permission?

> The application uses authorized Page context for the NUVANX Lead Ads workflow and Page-associated business data required by the advertising/lead retrieval integration.

### Page

> `1329458703573874`.

### Evidence

> Production App Review core-call run `32773483796` recorded `APP_REVIEW_pages_read_engagement=PASS`.

## `pages_manage_ads`

### Why do you need this permission?

> NUVANX Reporting uses the NUVANX Facebook Page in its advertising and Lead Ads workflow. `pages_manage_ads` supports the Page/ad relationship required to operate the NUVANX Page's advertising assets. The app does not use this permission to manage unrelated Pages.

### Page

> `1329458703573874`.

### Evidence

> Production App Review core-call run `32773483796` recorded `APP_REVIEW_pages_manage_ads=PASS`.

## `leads_retrieval`

### Why do you need this permission?

> NUVANX uses Meta Lead Ads to receive requests for medical-aesthetic valuation. The backend receives the Meta `leadgen_id`, retrieves the authorized lead record from Meta, stores the lead and its advertising attribution, and exposes the resulting record in the authenticated NUVANX CRM workflow.

### Data retrieved

> The backend requests the authorized Meta lead fields `field_data`, `created_time`, `ad_id`, `ad_name`, `form_id`, `form_name`, `campaign_id`, `campaign_name`, `adset_id`, `adset_name`, `page_id`, `is_organic` and `platform`.

### Reviewer path

> Login → CRM. Review the Meta-originated lead and its attribution context. The canonical form is `1493697602775666`.

### Evidence

> Production App Review core-call run `32773483796` recorded `APP_REVIEW_leads_retrieval=PASS`. Production auditing has also completed a real read of the active NUVANX Lead Form's leads endpoint.

# Allowed-usage consistency statement

Use this where the review asks for the allowed use case or how requested access benefits users:

> The requested access is used only for NUVANX's internal advertising and Lead Ads operations. Authenticated NUVANX users use campaign/ad performance data to monitor advertising performance and use Meta Lead Ads data to process valuation requests in the CRM. Server-side advertising management automation operates only on assets owned by the NUVANX Business Portfolio. The application does not sell Platform Data, does not use it to build unrelated user profiles, and does not request access to unrelated businesses or personal reviewer assets for this first review.

# Data handling — technically supported answers

Meta's legal/data-handling attestations must reflect actual organizational practice. The following answers separate verified technical facts from attestations that require the data controller/legal owner.

## Data processors/service providers

### Question

Do you have data processors or service providers, including your own companies, that will have access to Platform Data obtained from Meta?

### Recommended answer

**YES.**

### Directly verified processor

**Supabase**

Purpose:

> Supabase provides the production database, authentication and Edge Function/API infrastructure used by NUVANX Reporting. Meta Lead Ads data and advertising attribution can be processed/stored through this backend on behalf of NUVANX.

Primary production project region: `eu-central-1` (Frankfurt, Germany).

### Vercel handling note

The production React/Vite frontend is hosted by Vercel. Current code routes Meta API/business data through the authenticated browser-to-Supabase application API; no Vercel server-side Meta API route has been identified in the current repository. If the Meta questionnaire treats static web hosting/request telemetry as processor access to Platform Data, list Vercel as well; otherwise Supabase is the directly verified Platform Data processor in this application's backend data path.

Do not automatically copy every vendor from the general NUVANX privacy policy into this Meta-specific processor answer unless that vendor actually receives the Meta Platform Data covered by the requested permissions.

## Entity responsible for Platform Data

Recommended entry, subject to matching the exact legal entity shown by Meta Business Verification:

> NUVANX Medicina Estética Láser

Country:

> Spain

Before submission, use the exact verified legal entity name from the Business Verification record if it differs from the public trading name.

## Public-authority / national-security requests in the previous 12 months

**PENDING LEGAL ATTESTATION.**

This cannot be inferred from application code or technical logs. The business/data controller must answer the Meta question truthfully. Do not select “No” merely because no such request appears in the repository.

## Policies/processes for public-authority requests

**PENDING LEGAL ATTESTATION.**

Only select policy/process checkboxes that NUVANX actually has in place and can stand behind (for example legality review, challenge of unlawful requests, data minimization, and documentation, if applicable). Do not create a false compliance attestation solely to complete App Review.

# App settings — values to verify/save in Meta Dashboard

| Field | Value / action |
| --- | --- |
| Display name | `NUVANX Reporting` |
| App Domain | `nuvanx.com` |
| Privacy Policy URL | `https://nuvanx.com/politica-privacidad/` |
| Data deletion instructions URL | **CHANGE TO** `https://nuvanx.com/eliminacion-datos-meta/` |
| Reviewer website | `https://frontend-arisofias-projects-c2217452.vercel.app/` |
| Contact/support | Keep the currently verified Meta contact email; web login UI shows `support@nuvanx.com` |
| Website platform URL | Verify in Dashboard; if a Website platform URL is required for the hybrid web app, use the stable production frontend URL unless the existing Meta product configuration requires another canonical URL |

The production audit previously confirmed App Domain, Privacy Policy URL, Terms of Service URL and a contact email on the app object. It did not confirm a Website URL. The Dashboard must be treated as canonical for fields that Graph v22 did not return in the audit.

# Data deletion

Meta Dashboard must use:

`https://nuvanx.com/eliminacion-datos-meta/`

The previously saved value was:

`https://nuvanx.com/politica-privacidad/`

Do not submit until the dedicated deletion-instructions URL is visibly saved in Meta Dashboard.

# Permission scope for this submission

## Keep

1. Marketing API Access Tier
2. `ads_management`
3. `ads_read`
4. `business_management`
5. `pages_show_list`
6. `pages_read_engagement`
7. `pages_manage_ads`
8. `leads_retrieval`

## Remove/defer

- Threads oEmbed Read
- Meta oEmbed Read
- Live Video API
- Business Asset User Profile Access
- `threads_business_basic`
- `email`
- `manage_fundraisers`
- `pages_manage_metadata`
- `publish_video`
- `ads_mcp_management`
- `pages_messaging`
- `catalog_management`
- `threads_basic`
- `instagram_basic`
- `whatsapp_business_messaging`
- `public_profile`
- `whatsapp_business_management`

`pages_manage_metadata` is deferred because automated Page webhook subscription management is not part of the first review. This does not invalidate the separately proven `leads_retrieval` use case.

# Submission blockers / manual-only gates

1. **Business Verification** — status was `En revisión` on 2026-08-24. Meta controls this state.
2. **Data deletion URL** — must be changed/saved in the authenticated Meta Dashboard to `https://nuvanx.com/eliminacion-datos-meta/`.
3. **Reviewer account** — create and test a dedicated production Supabase email/password account; no such account currently exists.
4. **Reviewer account data access** — because Meta credentials are resolved per authenticated application user, verify the reviewer account has the required NUVANX integration access without copying secrets insecurely.
5. **`ads_management` screencast** — record a real server-to-server/System User management operation and resulting Meta state; do not fake a frontend Meta Login or a nonexistent management button.
6. **Legal data-handling attestations** — confirm the exact legal entity and the public-authority/national-security answers with the data controller/legal owner.
7. **Final Submit button** — only an authenticated Meta Dashboard session can save/submit the review form.

# Evidence inventory

- `32773483796` — App Review core calls PASS for ads_read, business_management, pages_show_list, pages_read_engagement, pages_manage_ads, leads_retrieval and Marketing API read.
- `32761212623` — full Meta app use-case read-only audit.
- `32761521018` — Page-token/Messenger/Instagram/WhatsApp detail audit.
- `32762760660` — app-domain/publication metadata audit.
- `32763162619` — Business System User inventory/token identity reconciliation.
- `32768146699` / job `97562196706` — Graph v22 app-object field probes.

# Architecture wording

Use consistently:

> Control plane: NUVANX Reporting → Meta Marketing API → Campaigns / Ad Sets / Ads / Creatives / Insights / Lead Ads.
>
> Measurement plane: WordPress → Supabase `web-events` → Meta Conversions API → Pixel/Dataset.
>
> These are separate flows. Marketing API permissions in this App Review are requested for the control plane; Conversions API operation is not being used to justify unrelated Marketing API permissions.
