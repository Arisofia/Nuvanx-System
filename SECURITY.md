# Security & Production Readiness

> **Pre-production system.** Do not connect production API keys until all gaps below are resolved.

---

## Resolved

| Area | Status |
|------|--------|
| Persistence | ✅ PostgreSQL via Supabase. Backend exits on startup if `DATABASE_URL` is missing in production. In-memory fallback retained for dev/test only. |
| Credential storage | ✅ AES-256-GCM encrypted, persisted to `credentials` table in PostgreSQL. |
| Row-Level Security | ✅ RLS policies deployed on all tables. Anon read removed from `dashboard_metrics`. |
| Backend auth | ✅ JWT bearer auth with PostgreSQL-backed user registration/login. |
| CI/CD | ✅ Backend tests + frontend lint/build in CI; auto-deploy to Railway on main. |

## Open Gaps

### 1. Authentication Hardening
- JWT 24h expiry with no refresh token rotation or revocation.
- **Required:** Refresh token rotation, token blacklist or session table.

### 2. OAuth Integrations
- Token storage only. No OAuth 2.0 PKCE flows for Meta or WhatsApp.
- **Required:** Full OAuth lifecycle before claiming integration support.

### 3. Webhook Reliability
- No retry policy, backoff, or dead-letter handling for inbound webhooks.
- **Required:** Signed request verification, queued processing, retry with exponential backoff, dead-letter queue.

### 4. Git History — Leaked Identifier
- `WHATSAPP_PHONE_NUMBER_ID` was committed in `.env.example` before commit `bf1d4e9`. Removed from HEAD but recoverable from history.
- **Risk:** Low (phone number ID, not an auth token).
- **Required:** Run `git filter-repo` or `BFG Repo-Cleaner` before making repo public.

### 5. Credential Key Management
- AES master key is a raw env var (`ENCRYPTION_KEY`).
- **Required:** In production, use a KMS (AWS KMS, Doppler, HashiCorp Vault).

### 6. GDPR / LOPD Compliance
- No consent records, no erasure endpoint, no DPA with sub-processors.
- **Required:** Article 30 records, data subject rights endpoints, DPAs with Meta/OpenAI.

### 7. Monitoring & Alerting
- Grafana Alloy config exists but is not deployed. Winston logging to stdout only.
- **Required:** Sentry error tracking, structured JSON logging, uptime monitoring.

### 8. Missing Features
- Email transport for password reset (token generated but not sent).
- Live telemetry (`/live`) has placeholder chart/feed — no real event stream.
- Some CRM actions (Notes) are not wired to backend services.

## External Blockers

- Meta Graph API business verification and high-risk scope approvals are pending.

---

## Reporting a Vulnerability

Do **not** file a public issue. Contact the repository owner via the email on the GitHub profile.

Expected response time: 48 hours.
