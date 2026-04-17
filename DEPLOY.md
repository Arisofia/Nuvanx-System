# DEPLOY.md — Nuvanx System Deployment Runbook

Step-by-step guide to go from code to a live system.

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Node 20 LTS | Backend & frontend |
| Supabase project | PostgreSQL + Auth |
| Render account | Backend hosting |
| Vercel account | Frontend hosting |
| GitHub repo secrets | CI/CD automation |

---

## 1. Supabase — Database Setup

1. Go to **supabase.com → Project Settings → Database → Connection string** and copy the **URI** (starts with `postgresql://...`).
2. That value is your `DATABASE_URL`.
3. Run all migrations against Supabase:

```bash
# Option A — via supabase CLI (recommended)
npx supabase db push --db-url "$DATABASE_URL"

# Option B — manually, one by one
psql "$DATABASE_URL" -f backend/src/db/migrations/001_initial_schema.sql
psql "$DATABASE_URL" -f backend/src/db/migrations/011_clinics.sql
psql "$DATABASE_URL" -f backend/src/db/migrations/012_lead_dedup.sql
psql "$DATABASE_URL" -f backend/src/db/migrations/013_multitenant_rls.sql
```

4. Grab these values from **Project Settings → API**:
   - `SUPABASE_URL` (https://ssvvuuysgxyqvmovrlvk.supabase.co)
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET` (JWT Settings section)

---

## 2. Environment Variables

Set these on your hosting platform (Render, Vercel) and in `.env` for local dev.

### Required

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | ≥ 32 chars, random string for signing JWTs |
| `ENCRYPTION_KEY` | ≥ 32 chars, AES-256 key for credential vault |
| `DATABASE_URL` | Supabase connection string (required in production) |

### Supabase

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (backend only, never expose) |
| `SUPABASE_JWT_SECRET` | Accepts Supabase access tokens as Bearer JWTs |

### External Services (optional until needed)

| Variable | Description |
|----------|-------------|
| `META_ACCESS_TOKEN` | Facebook/Meta Marketing API token |
| `META_AD_ACCOUNT_ID` | Meta ad account ID |
| `META_APP_SECRET` | For webhook signature verification |
| `META_VERIFY_TOKEN` | Webhook subscription verification token |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Business Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `RESEND_API_KEY` | Resend.com key for transactional email |
| `EMAIL_FROM` | From address (default: `Nuvanx <noreply@nuvanx.com>`) |
| `SENTRY_DSN` | Sentry error tracking DSN |
| `WEBHOOK_ADMIN_USER_ID` | UUID of admin user who receives webhook-originated leads |
| `ALLOW_SHARED_CREDENTIALS` | `true` (single-tenant) or `false` (multi-tenant) |
| `FRONTEND_URL` | Frontend origin for CORS (default: `http://localhost:5173`) |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID (for Calendar integration) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | OAuth2 redirect URI (e.g., `https://YOUR_BACKEND_URL/api/google-calendar/callback`) |

---

## 3. Deploy Backend to Render

The repo includes `render.yaml` for Blueprint deploys.

1. Go to **render.com → New → Blueprint** and connect the GitHub repo.
2. Render auto-detects `render.yaml` and creates the backend web service.
3. In the Render dashboard, set all env vars from §2.
4. **Auto-deploy** is enabled — every push to `main` triggers a redeploy.

Manual deploy via API (used by CI/CD):
```bash
curl "https://api.render.com/deploy/srv-$RENDER_SERVICE_ID?key=$RENDER_API_KEY"
```

---

## 4. Deploy Frontend to Vercel

1. Go to **vercel.com → New Project** and import the GitHub repo.
2. Set **Root Directory** to `frontend`.
3. Set **Framework Preset** to `Vite`.
4. Add env var: `VITE_API_URL` = your Render backend URL (e.g., `https://nuvanx-backend.onrender.com`).
5. Deploy. The `frontend/vercel.json` handles SPA rewrites automatically.

---

## 5. CI/CD — GitHub Secrets

Set these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `RENDER_API_KEY` | Render API key (Account Settings → API Keys) |
| `RENDER_SERVICE_ID` | Render service ID (`srv-xxx`) |
| `VERCEL_TOKEN` | Vercel personal access token |
| `VERCEL_ORG_ID` | Vercel team/org ID |
| `VERCEL_PROJECT_ID` | Vercel frontend project ID |

The deploy workflow (`.github/workflows/deploy.yml`) runs automatically after CI passes on `main`.

---

## 6. Create First User

```bash
curl -X POST https://YOUR_BACKEND_URL/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@yourcompany.com", "password": "SecurePassword123!", "name": "Admin User"}'
```

Save the returned user UUID — you'll need it for `WEBHOOK_ADMIN_USER_ID`.

---

## 7. Register a Clinic

```sql
-- Run against Supabase SQL editor or psql
INSERT INTO clinics (name, slug, timezone)
VALUES ('My Clinic', 'my-clinic', 'America/New_York')
RETURNING id;

-- Assign user to clinic (replace UUIDs)
UPDATE users SET clinic_id = '<clinic-uuid>' WHERE id = '<user-uuid>';
```

---

## 8. Connect Meta & WhatsApp

### Meta (Facebook Ads)

1. Create a Meta App at **developers.facebook.com**.
2. Generate a System User access token with `ads_read`, `ads_management` permissions.
3. Set `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_SECRET` in env.
4. Connect via API:

```bash
curl -X POST https://YOUR_BACKEND_URL/api/integrations/connect \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"service": "meta"}'
```

### WhatsApp Business

1. In the same Meta App, enable the WhatsApp product.
2. Copy the **Phone Number ID** and **Access Token** from WhatsApp → API Setup.
3. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` in env.
4. Configure the webhook URL: `https://YOUR_BACKEND_URL/api/webhooks/whatsapp`
5. Set the webhook verify token to match `META_VERIFY_TOKEN`.
6. Connect via API:

```bash
curl -X POST https://YOUR_BACKEND_URL/api/integrations/connect \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"service": "whatsapp"}'
```

---

## 9. Insert Real Leads

```bash
curl -X POST https://YOUR_BACKEND_URL/api/leads \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "source": "meta",
    "stage": "lead"
  }'
```

Leads arriving via Meta/WhatsApp webhooks are automatically created and de-duplicated by phone/email.

---

## 10. Connect Google Calendar (Appointment Booking)

1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Set the redirect URI to `https://YOUR_BACKEND_URL/api/google-calendar/callback`.
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in env.
5. Enable **Google Calendar API** in the Cloud Console.
6. From the frontend or API, get the auth URL:

```bash
curl https://YOUR_BACKEND_URL/api/google-calendar/auth-url \
  -H "Authorization: Bearer YOUR_JWT"
```

7. Open the returned URL in a browser, sign in with your Google account, and authorize.
8. After the callback completes, you can create calendar events:

```bash
curl -X POST https://YOUR_BACKEND_URL/api/google-calendar/events \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Cita con Jane Doe",
    "startDateTime": "2026-04-20T10:00:00-05:00",
    "endDateTime": "2026-04-20T10:30:00-05:00",
    "attendees": ["jane@example.com"],
    "timeZone": "America/Mexico_City"
  }'
```

---

## 11. Playbook Automation

Playbook automations run automatically when leads arrive via webhooks:

- **lead_capture_nurture**: When a new Meta or WhatsApp lead arrives with a phone number, a WhatsApp welcome message is sent automatically (requires WhatsApp integration connected).

To verify the `lead_capture_nurture` playbook exists in the DB:

```sql
SELECT id, slug, status FROM playbooks WHERE slug = 'lead_capture_nurture';
```

If missing, insert it:

```sql
INSERT INTO playbooks (slug, title, description, category, status, steps)
VALUES (
  'lead_capture_nurture',
  'Lead Capture & Nurture',
  'Automatically welcomes new leads via WhatsApp',
  'automation',
  'active',
  '[{"action": "whatsapp_welcome", "trigger": "lead_created"}]'
);
```

---

## 12. RLS Policies (Security)

The latest migration (`014_rls_with_check.sql`) adds WITH CHECK policies on `integrations` and `credentials` tables. Push it:

```bash
psql "$DATABASE_URL" -f backend/src/db/migrations/014_rls_with_check.sql
```

---

## 13. Dashboard Metrics Sync

The backend automatically syncs computed KPIs (leads, revenue, integration statuses) to the Figma Supabase `dashboard_metrics` table every 5 minutes. No setup required beyond having `SUPABASE_FIGMA_URL` and `SUPABASE_FIGMA_SERVICE_KEY` set.

Manual trigger:

```bash
curl -X POST https://YOUR_BACKEND_URL/api/dashboard/sync \
  -H "Authorization: Bearer YOUR_JWT"
```

---

## 14. Verify Health

```bash
# Backend health check
curl https://YOUR_BACKEND_URL/health

# Should return: {"status":"ok","timestamp":"..."}
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Missing required environment variables` | Check `JWT_SECRET` and `ENCRYPTION_KEY` are set |
| `DATABASE_URL is required` in production | Set `DATABASE_URL` to Supabase connection string |
| Webhook leads not arriving | Verify `WEBHOOK_ADMIN_USER_ID` is set to a valid user UUID |
| CORS errors on frontend | Set `FRONTEND_URL` to your Vercel domain |
| Email not sending | Set `RESEND_API_KEY` and verify domain in Resend dashboard |
