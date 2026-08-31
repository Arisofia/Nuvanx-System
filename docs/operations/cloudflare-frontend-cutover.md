# Cloudflare frontend cutover runbook
 
## Objective
 
Move the NUVANX Control Centre frontend from Vercel to Cloudflare Workers Static Assets without changing the Supabase backend contract, exposing secrets, or removing the rollback path before production acceptance.
 
## Canonical deployment contract
 
- Worker name: `nuvanx-frontend`
- Build output: `frontend/dist/`
- Wrangler config: `frontend/wrangler.jsonc`
- SPA fallback: `not_found_handling = "single-page-application"`
- Browser headers: `frontend/public/_headers`
- Acceptance workflow: `.github/workflows/deploy-cloudflare.yml`
- Vercel remains the rollback origin until the custom-domain acceptance is complete.
 
## Secrets
 
Never paste Cloudflare tokens into chat, issues, commits, logs, or frontend variables.
 
Repository Actions secrets required by the manual acceptance workflow:
 
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SENTRY_DSN` when Sentry browser telemetry is enabled
 
Backend-only secrets, including `MCP_API_KEY` and Supabase service-role credentials, must never be exposed as `VITE_*` variables.
 
## Phase 1 — workers.dev acceptance
 
1. Confirm the Cloudflare account has a Workers `workers.dev` subdomain.
2. In GitHub Actions run **Cloudflare Frontend Acceptance**, passing the approved `main` commit in the `approved_sha` input (the workflow validates checkout of that exact SHA).
3. Record the commit SHA and the resulting `nuvanx-frontend.<account-subdomain>.workers.dev` URL.
4. Add the recorded `workers.dev` origin to Supabase Auth redirect configuration and to the Edge Function CORS allowlist (`CORS_ALLOWED_ORIGINS`) so the authenticated/API checks below can pass. Do not replace the allowlist with `*`.
5. Verify:
   - `/` returns the current Control Centre build;
   - a deep route opened directly returns the SPA rather than a 404;
   - static assets load from `/assets/`;
   - `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and CSP are present;
   - Supabase API calls succeed from the Cloudflare origin;
   - login, session refresh and logout work;
   - no browser console error indicates CORS/CSP/auth redirect failures;
   - no backend secret appears in the generated JS bundle.
6. Keep this temporary acceptance hostname out of search indexing. Do not change production DNS yet.
 
## Phase 2 — Supabase Auth/CORS parity
 
Only after the concrete Cloudflare acceptance URL exists:
 
1. Add the required Cloudflare acceptance/custom-domain URLs to Supabase Auth redirect configuration.
2. Validate Edge Function CORS behavior against the exact origin. Do not replace an allowlist with `*` merely to make acceptance pass.
3. Validate Realtime/WebSocket connectivity if used by the frontend.
4. Re-run authenticated Playwright/smoke flows against the Cloudflare URL.
 
## Phase 3 — custom domain
 
1. Capture the complete current DNS record (type, name, value, TTL, proxy status) for the frontend hostname and store it as the rollback target.
2. If a CNAME to Vercel exists on that hostname, remove it — Cloudflare cannot create a Custom Domain over an existing CNAME record.
3. Attach the final frontend custom domain in Cloudflare and record the resulting DNS change.
4. Verify TLS, SPA deep links, security headers, Auth redirects, API/CORS and authenticated flows on the custom domain.
5. Confirm the deployed Cloudflare version corresponds to the approved Git commit.
6. Keep Vercel intact through the acceptance window.
 
## Rollback
 
If the Cloudflare custom-domain acceptance fails:
 
1. Restore the prior DNS target or route to the last accepted Vercel deployment.
2. Revert temporary Supabase Auth redirect changes only if they are no longer needed; do not remove the production rollback origin prematurely.
3. Record the Cloudflare deployment/version and failed acceptance condition.
4. Fix forward in a PR and repeat workers.dev/custom-domain acceptance.
 
Database migrations, Supabase Edge Functions and backend credentials are independent of this frontend rollback and must not be rolled back solely because the static frontend host changes.
 
## Vercel decommission gate
 
Remove Vercel only after all of the following are true:
 
- Cloudflare custom domain is live and accepted;
- authenticated production smoke tests pass;
- Supabase Auth/CORS parity is verified;
- Cloudflare deployment is traceable to the approved commit;
- rollback procedure has been demonstrated;
- production monitoring shows no hosting-related regression.
 
Then remove `frontend/vercel.json`, Vercel-specific CI gates/docs/secrets and the Vercel GitHub integration in a dedicated cleanup change.
