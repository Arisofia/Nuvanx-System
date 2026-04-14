# Backend Readiness Gap Analysis

**Repository:** Arisofia/Nuvanx-System
**Last Updated:** 2026-04-13
**Source:** Verified against `backend/src/` actual contents

> This document honestly documents the gap between the current backend implementation and a production-ready system. Do not deploy this backend to production without addressing the items marked ❌.

---

## 1. Current Persistence Model

### Model: DB-first with in-memory fallback

All three data models (`credential.js`, `integration.js`, `lead.js`) follow the same pattern:

```
if DATABASE_URL is set → try PostgreSQL → on failure, fall back to in-memory
if DATABASE_URL is not set → use in-memory Map
```

**Consequence:** Without `DATABASE_URL`, **all data is lost on server restart**. This includes:
- All leads / CRM records
- All integration status records
- All encrypted credentials

This is acceptable for local development but **must not be deployed to production without a database**.

### Exception: User accounts

`backend/src/routes/auth.js` uses an **in-memory `Map`** for users:

```js
// In-memory user store (TODO: replace with PostgreSQL)
const users = new Map();
```

**This has no DB fallback at all.** Even if `DATABASE_URL` is set, users registered via `/api/auth/register` will be lost on restart. This is the most critical production gap.

**Workaround:** Use Supabase Auth (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `SUPABASE_JWT_SECRET`) which delegates user management to Supabase and sidesteps this limitation entirely.

### Database Schema

A migration file exists at `backend/src/db/migrations/001_initial_schema.sql`. It is **not applied automatically**. It must be run manually (e.g., `psql $DATABASE_URL < backend/src/db/migrations/001_initial_schema.sql`).

The schema covers: `users`, `credentials`, `integrations`, `leads`.

### Legacy file

`backend/src/config/database.js` exists but is **unused** — no `require()` in any active file points to it. The active DB pool is in `backend/src/db/index.js`. The legacy file should be removed to avoid confusion.

---

## 2. Credential Storage Model

### Storage

Credentials (API keys) are stored as:
```
AES-256-GCM encrypt(rawKey, ENCRYPTION_KEY) → salt:iv:authTag:ciphertext (hex, colon-delimited)
```

Implementation: `backend/src/services/encryption.js` using Node.js native `crypto` module (no third-party crypto lib).

### Security properties
- ✅ Raw API keys never returned to the frontend
- ✅ Keys encrypted at rest with AES-256-GCM + PBKDF2 (100k rounds)
- ✅ `ENCRYPTION_KEY` lives in server environment only
- ✅ Rotation-ready (re-encrypt all with new key without losing data)
- ⚠️ `ENCRYPTION_KEY` is a server-level env var — if leaked, all credentials are compromised
- ⚠️ No key rotation tooling exists yet (documented gap only)

### Key resolution priority

For service calls, credentials are resolved in this order:
1. Per-user encrypted vault (DB or in-memory)
2. Server-level env var defaults (`META_ACCESS_TOKEN`, `OPENAI_API_KEY`, etc.)

The env var fallback is useful for single-tenant dev environments but creates a **security risk in multi-tenant production**: one user's call could consume a shared service credential.

---

## 3. Integration Limitations

| Integration | Known Limitation |
|-------------|-----------------|
| **Google Calendar / Gmail** | No OAuth 2.0 callback route. Users must paste a refresh token manually. This is not a real OAuth flow and will not work for most users who don't know how to extract OAuth tokens from Google Cloud Console. |
| **Meta** | Requires a long-lived access token. Token refresh is not implemented. Tokens expire after ~60 days and must be refreshed manually. |
| **WhatsApp** | Send endpoint exists in `services/whatsapp.js` but is **not exposed as an API route**. The frontend cannot trigger WhatsApp sends. |
| **GitHub** | Token verification only. No actual automation (script execution, file write) is implemented beyond connection testing. |
| **HubSpot** | Trend data works. No real-time sync (no webhooks). |
| **All integrations** | No webhook receiver routes. Real-time event ingestion (Meta lead forms, WhatsApp incoming messages) is not implemented. |

---

## 4. Authentication Gaps

| Item | Status | Risk |
|------|--------|------|
| Custom JWT user store | In-memory only | 🔴 High — all users lost on restart |
| JWT stored in localStorage | Insecure | 🟡 Medium — XSS vulnerability; should use httpOnly cookie |
| No `/api/auth/logout` route | Missing | 🟡 Medium — token invalidation not possible (use short `jwtExpiresIn`) |
| No password reset flow | Missing | 🟡 Medium — users locked out if password forgotten |
| No email verification | Missing | 🟡 Medium — anyone can register |
| Supabase Auth | ✅ Available | Use for production to bypass all custom auth gaps |

---

## 5. API Security Status

| Security Layer | Status | Notes |
|----------------|--------|-------|
| JWT authentication | ✅ Implemented | All routes protected except `/health` and `/api/auth/*` |
| Helmet.js headers | ✅ Implemented | `X-Content-Type-Options`, `HSTS`, etc. |
| Rate limiting | ✅ Implemented | 100/15min general, 20/15min auth, 10/min AI |
| CORS | ✅ Implemented | Locked to `FRONTEND_URL` |
| Input validation | ✅ Implemented | express-validator on auth, AI, lead routes |
| SQL injection | ✅ Protected | Parameterized queries throughout |
| HTTPS | ❌ Not enforced | Depends on deployment infrastructure (reverse proxy) |
| Request size limit | ✅ Implemented | `express.json({ limit: '1mb' })` |

---

## 6. Test Coverage

**Current:** 30 Jest tests across 4 files.

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `auth.test.js` | ~8 | JWT auth middleware: valid, expired, wrong secret, missing header, Supabase JWT |
| `credentials.test.js` | ~8 | Credential vault: save, retrieve, list, delete, no raw key leakage |
| `encryption.test.js` | ~6 | AES-256 roundtrip, wrong key failure, format validation |
| `integrations.test.js` | ~8 | Integration list, connect, status update |

**Not tested:**
- Dashboard routes (metrics, funnel, revenue-trend)
- AI routes (generate, analyze-campaign, suggestions)
- Leads routes (CRUD)
- Error edge cases in service files
- Database path (tests use in-memory fallback only)

---

## 7. What Is Required for Production Readiness

### Minimum viable production checklist

- [ ] **Replace in-memory user store** with PostgreSQL users table (or use Supabase Auth)
- [ ] **Apply DB migration** (`001_initial_schema.sql`) to a real PostgreSQL instance
- [ ] **Set `DATABASE_URL`** in production environment
- [ ] **Set strong `JWT_SECRET`** (min 64 chars) and `ENCRYPTION_KEY` (min 64 chars) as secrets
- [ ] **Move JWT to httpOnly cookie** or accept Supabase tokens (which have better security properties)
- [ ] **Enable HTTPS** via reverse proxy (Nginx, Caddy, or cloud load balancer)
- [ ] **Configure `FRONTEND_URL`** to production domain (not localhost)
- [ ] **Remove or restrict** the in-memory fallback in production (currently silently degrades)

### Recommended for full production

- [ ] OAuth 2.0 callback flow for Google (Calendar + Gmail)
- [ ] Meta token refresh mechanism
- [ ] WhatsApp send route exposed (`POST /api/integrations/whatsapp/send`)
- [ ] Webhook receiver routes (`POST /api/webhooks/meta`, `/api/webhooks/whatsapp`)
- [ ] Database migration runner (e.g., `node-pg-migrate` or Flyway)
- [ ] Monitoring / alerting (e.g., Sentry for error tracking)
- [ ] Key rotation tooling for `ENCRYPTION_KEY`
- [ ] Docker Compose for local dev + production deployment
- [ ] `/api/auth/logout` route (JWT blocklist or short token TTL)
- [ ] Password reset flow

---

## 8. Summary

```
In-memory user store:     ❌ CRITICAL — replace before any production use
PostgreSQL persistence:   ⚠️ OPTIONAL in dev, REQUIRED in production
Credential encryption:    ✅ Strong (AES-256-GCM)
JWT authentication:       ✅ Works (but localStorage storage is weak)
Integration calls:        ✅ Real HTTP (not mocked in production)
Webhook ingestion:        ❌ MISSING — no real-time event ingestion
Google OAuth:             ❌ INCOMPLETE — no callback flow
Test coverage:            ⚠️ PARTIAL — core crypto/auth tested; routes undertested
Deployment config:        ❌ MISSING — no Docker, no Procfile
```

The backend is **suitable for demos and development** but requires the items above before handling real user data in production.
