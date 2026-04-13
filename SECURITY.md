# Security Notice — Pre-Production Status

> **This system is pre-alpha and is NOT suitable for handling real patient or clinic data.**  
> Do not connect real API keys that have access to production data until all items below are resolved.

---

## Known Gaps (must be resolved before go-live)

### 1. Persistence
- **Status:** In-memory Maps — all data is lost on every process restart / deploy.
- **Required:** Supabase PostgreSQL schema deployed. See `backend/src/db/migrations/001_initial_schema.sql`.
- **How to enable:** Set `DATABASE_URL` or `SUPABASE_DATABASE_KEY` environment variable.

### 2. Credential Storage
- **Status:** AES-256-GCM encrypted (native Node crypto + PBKDF2) but stored in RAM — lost on restart.
- **Required:** Credentials persisted to the `credentials` table in PostgreSQL, or migrated to [Supabase Vault](https://supabase.com/docs/guides/database/vault).
- **Risk:** Current AES master key is a raw env var. In production, use a KMS (AWS KMS, Doppler, HashiCorp Vault).

### 3. Authorization (Row-Level Security)
- **Status:** Application-level user ID filtering only.
- **Required:** PostgreSQL Row Level Security policies enabled (included in migration). Verify user A cannot access user B's data with an explicit authorization test.

### 4. Authentication
- **Status:** JWT verification with 24h expiry. No refresh token. No revocation.
- **Required:** Add refresh token rotation and a token blacklist/session table. Consider Supabase Auth.

### 5. OAuth Integrations
- **Status:** Token storage only. No OAuth 2.0 PKCE flows implemented.
- **Required:** Full OAuth flows for Meta, Google, and WhatsApp before claiming integration support.

### 6. GDPR / LOPD Compliance (Spain)
- **Status:** No consent records, no erasure endpoint, no DPA with sub-processors.
- **Required before handling any EU personal data:** Article 30 Records of Processing, data subject rights endpoints, DPAs with Google/Meta/OpenAI/HubSpot.

### 7. HIPAA (if US clinics served)
- **Status:** No audit controls, no integrity controls, no BAA.
- **Required:** BAA with all sub-processors; audit_log table (included in migration) must be populated on every read/write of PHI.

### 8. Monitoring & Alerting
- **Status:** Winston logging to stdout only.
- **Required:** Sentry for error tracking, structured JSON logging, uptime monitoring, p95 latency SLO alerts.

---

## Reporting a Vulnerability

If you discover a security vulnerability, please do **not** file a public issue.  
Contact the repository owner directly via the email on the GitHub profile.

Expected response time: 48 hours.
