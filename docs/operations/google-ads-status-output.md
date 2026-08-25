# Google Ads status output ownership

Canonical flow: `public.vw_google_ads_connection_status` → authenticated `GET /api/google-ads/status` → Vercel `/marketing` Google Ads panel.

The view is secret-free and direct `anon`/`authenticated` access is revoked. Only the server-side service role queries it. The browser receives connection state, Customer ID, credential presence and timestamps; it never receives credential IDs, encrypted keys, tokens or raw credential metadata.

The production baseline was created by migration `20260825082322`. Follow-up migration `20260825090205` preserves that immutable ledger entry while adding two diagnostics: whitespace-normalized Customer IDs and credential-only partial states when a credential exists without a matching integration row.

`npm run google-ads:status` executes `scripts/check-google-ads-db.js`, which reads the same view with `SUPABASE_SERVICE_ROLE_KEY` and exits non-zero if no Google Ads row exists or if a selected row is not operational.

Owners:
- Database state: Supabase `vw_google_ads_connection_status`.
- API: Supabase Edge `api` / `GET /api/google-ads/status`.
- Human output: Vercel Control Centre `/marketing`.
- CLI/CI diagnostic: `scripts/check-google-ads-db.js`.
