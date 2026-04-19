# GitHub Secrets & Vercel Environment Variables Setup

> **Status**: Keys must be migrated to GitHub Secrets + Vercel environment variables
> 
> **Problem**: Previously, keys were hardcoded in `.github/workflows/deploy.yml` (EXPOSED!)
> 
> **Fix**: Now pulls from GitHub Secrets (secure)

---

## Quick Setup

### Step 1: Upload Keys to GitHub Secrets

Run this from your local machine (requires `backend/.env` with real credentials):

```bash
cd scripts
node upload-github-secrets.js
```

This uploads **38 secrets** to GitHub, including:
- ✅ `VITE_SUPABASE_URL`
- ✅ `VITE_SUPABASE_ANON_KEY` (frontend visibility OK, scoped by RLS)
- ✅ `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (backend)
- ✅ `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- ✅ All AI/Meta/WhatsApp/GitHub keys

### Step 2: Verify in GitHub UI

1. Go to: **GitHub Repo → Settings → Secrets and variables → Actions**
2. You should see ~38 secrets listed
3. All prefixed correctly for their use:
   - `VITE_*` → Frontend (build-time injection)
   - `SUPABASE_*` → Backend (server-side)
   - `META_*` → Meta integrations
   - `VERCEL_*` → Deployment

### Step 3: Vercel Auto-Links Environment Variables

When you deploy to Vercel via GitHub Actions:

```yaml
env:
  VERCEL_TOKEN: "${{ secrets.VERCEL_TOKEN }}"
  VITE_SUPABASE_URL: "${{ secrets.VITE_SUPABASE_URL }}"       # ← Injected at build
  VITE_SUPABASE_ANON_KEY: "${{ secrets.VITE_SUPABASE_ANON_KEY }}"
```

These are automatically available in:
- **Frontend build** as `import.meta.env.VITE_*`
- **Vercel deployments** as environment variables

---

## Detailed Mapping

### GitHub Secrets → Frontend (Build-time)

| GitHub Secret | Frontend Variable | Purpose |
|---------------|-------------------|---------|
| `VITE_SUPABASE_URL` | `import.meta.env.VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `import.meta.env.VITE_SUPABASE_ANON_KEY` | Supabase anon key (safe via RLS) |

### GitHub Secrets → Backend (Environment)

| GitHub Secret | Backend Env Var | Purpose |
|---------------|-----------------|---------|
| `SUPABASE_URL` | `process.env.SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `process.env.SUPABASE_ANON_KEY` | Anon key (used by frontend client) |
| `SUPABASE_SERVICE_ROLE_KEY` | `process.env.SUPABASE_SERVICE_ROLE_KEY` | Admin key (server-only) |
| `SUPABASE_JWT_SECRET` | `process.env.SUPABASE_JWT_SECRET` | JWT signing key |
| `DATABASE_URL` | `process.env.DATABASE_URL` | PostgreSQL connection string |
| `ENCRYPTION_KEY` | `process.env.ENCRYPTION_KEY` | AES-256 vault encryption |

### GitHub Secrets → Vercel Deployment

| GitHub Secret | Vercel Variable | Purpose |
|---------------|-----------------|---------|
| `VERCEL_TOKEN` | GitHub Actions env | Deploy authorization |
| `VERCEL_ORG_ID` | GitHub Actions env | Vercel organization |
| `VERCEL_PROJECT_ID` | GitHub Actions env | Vercel project ID |

---

## File Changes (Security Fix)

### Before (EXPOSED ⚠️)
```yaml
# .github/workflows/deploy.yml
env:
  VITE_SUPABASE_URL: https://ssvvuuysgxyqvmovrlvk.supabase.co  # ← HARDCODED!
  VITE_SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiI...            # ← EXPOSED!
```

### After (SECURE ✅)
```yaml
# .github/workflows/deploy.yml
env:
  VITE_SUPABASE_URL: "${{ secrets.VITE_SUPABASE_URL }}"
  VITE_SUPABASE_ANON_KEY: "${{ secrets.VITE_SUPABASE_ANON_KEY }}"
```

### Updated Scripts

**scripts/upload-github-secrets.js** now includes:
```js
const SECRETS_MAP = {
  // ... other secrets
  VITE_SUPABASE_URL:      'SUPABASE_URL',
  VITE_SUPABASE_ANON_KEY: 'SUPABASE_ANON_KEY',
  // ... rest of secrets
};
```

---

## Complete Secret List (38 total)

### Core Security (3)
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `DATABASE_URL`

### Supabase (6)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_FIGMA_URL`
- `SUPABASE_FIGMA_SERVICE_ROLE`

### Frontend Build (2)
- `VITE_SUPABASE_URL` (from SUPABASE_URL)
- `VITE_SUPABASE_ANON_KEY` (from SUPABASE_ANON_KEY)

### Deployment (3)
- `RENDER_DEPLOY_HOOK_URL`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (static fallback)

### GitHub & Tools (2)
- `GH_PAT` (→ GITHUB_PAT)
- `FIGMA_PAT`

### AI Providers (4)
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`

### Meta/Facebook (6)
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `META_BUSINESS_ID`
- `META_PAGE_ID`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`

### WhatsApp (2)
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`

### Operations (2)
- `WEBHOOK_ADMIN_USER_ID`
- `CLINIC_ID`

---

## ⚠️ Security Notes

### ✅ Safe to Expose
- `VITE_SUPABASE_URL` — URL is public anyway
- `VITE_SUPABASE_ANON_KEY` — Frontend visibility OK, protected by Supabase RLS policies

### ❌ NEVER Expose
- `SUPABASE_SERVICE_ROLE_KEY` — Admin privileges, server-only
- `JWT_SECRET`, `ENCRYPTION_KEY` — Core security
- `*_ACCESS_TOKEN`, `*_API_KEY` — Third-party credentials
- `DATABASE_URL` — DB connection string with password

---

## Troubleshooting

### "Deploy failed — VITE_SUPABASE_URL is missing"
→ Check GitHub Secrets: `VITE_SUPABASE_URL` must be set
→ Run: `node scripts/upload-github-secrets.js`

### "Frontend build has undefined VITE_SUPABASE_URL"
→ Verify: `.github/workflows/deploy.yml` uses `${{ secrets.VITE_SUPABASE_URL }}`
→ Check: Vercel detected the env vars from GitHub workflow

### "Supabase Auth failing"
→ Backend: Verify `SUPABASE_URL`, `SUPABASE_JWT_SECRET` in GitHub Secrets
→ Frontend: Verify `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` are set

---

## Workflow Flow

```
Local backend/.env
        ↓
        └→ node scripts/upload-github-secrets.js
                ↓
            GitHub Actions Secrets (38 keys)
                ↓
        ┌───────┴───────┐
        ↓               ↓
   CI/CD Workflow   Deploy Workflow
        ↓               ↓
   Tests pass     Vercel deployment
   (mocked)       (env vars injected)
                        ↓
                  Vercel preview/prod
                  (frontend with real keys)
```

---

## Next Steps

1. ✅ **Run**: `node scripts/upload-github-secrets.js` (from your local machine)
2. ✅ **Verify**: Go to GitHub → Settings → Secrets → see all 38 keys
3. ✅ **Deploy**: Next push to main triggers CI → Deploy workflow
4. ✅ **Confirm**: Vercel deployment succeeds with correct env vars

---

**Last Updated**: 2026-04-19  
**Status**: Secure — All secrets in GitHub Actions, none hardcoded in repo
