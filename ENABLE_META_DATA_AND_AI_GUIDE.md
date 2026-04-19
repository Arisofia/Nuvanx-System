# Meta Data & Agent Outputs - Deployment & Activation Guide

## Current Status

### ✅ What's Working
- **Meta Routes**: `/api/meta/insights` and `/api/meta/campaigns` are correctly implemented
- **Credential Parsing**: Fixed to handle JSON vault format with access_token and ad_account_id
- **Agent Routes**: `/api/ai/suggestions`, `/api/ai/analyze-campaign`, `/api/ai/status` configured
- **Database**: All tables and KPI views exist in Supabase
- **Frontend**: React dashboard ready to display Meta data and agent outputs
- **Workflows**: GitHub Actions CI/Deploy fully fixed and operational

### ❌ Why You Don't See Meta Data & Agent Outputs Live
**Root Cause**: Backend service not deployed to Render
- Render URL `https://nuvanx-backend.onrender.com/api` returns 404
- Service `nuvanx-backend` does not exist on Render dashboard
- Without backend, frontend can't fetch Meta data or agent outputs

## How to Enable Meta Data & Agent Outputs in Live Product

### Phase 1: Deploy Backend to Render (Required)

**Step 1**: Create Render Backend Service
1. Go to https://dashboard.render.com/new/blueprint
2. Connect your GitHub repo: `https://github.com/Arisofia/Nuvanx-System`
3. Select branch: `main`
4. Authorize Render to access your repository
5. Click "Create New Services"
6. Let Render deploy the backend service from `render.yaml`

**Step 2**: Get Deploy Hook URL
1. After service creation, go to Render Dashboard
2. Click on service `nuvanx-backend`
3. Navigate to Settings → Deploy Hook
4. Copy the Deploy Hook URL

**Step 3**: Add GitHub Secret for Auto-Deployment
1. Go to GitHub repo Settings → Secrets and variables → Actions
2. Add new secret: `RENDER_DEPLOY_HOOK_URL` = (paste the URL from Step 2)
3. Save

**Step 4**: Verify Backend is Running
- Navigate to https://nuvanx-backend.onrender.com/health
- Should return HTTP 200 with health status
- Once successful, frontend will automatically start fetching Meta data and agent outputs

### Phase 2: Set Up Meta Credentials (After Backend Deployed)

**Step 1**: Get Meta Credentials
1. Go to Facebook Business Manager (https://business.facebook.com)
2. Create or get your Meta App
3. Generate permanent access token
4. Copy your Ad Account ID (format: act_1234567890)

**Step 2**: Add GitHub Secrets for Credential Seeding
1. GitHub repo Settings → Secrets and variables → Actions
2. Add these secrets:
   - `META_ACCESS_TOKEN` = (your token)
   - `META_AD_ACCOUNT_ID` = (your ad account ID)
   - `META_BUSINESS_ID` = (optional, for enhanced permissions)
   - `META_PAGE_ID` = (optional, for page insights)

**Step 3**: Trigger Credential Seeding
1. Go to GitHub Actions
2. Select "Seed Credentials to Supabase" workflow
3. Click "Run workflow"
4. Type "seed" in the confirmation input
5. Click "Run workflow"
6. Wait for completion (should show "Seeded 8 credentials")

**Step 4**: Verify in Frontend
1. Navigate to frontend dashboard
2. Go to Integrations page
3. Look for "Meta" - should show status: "connected"
4. Go to Intelligence → Meta Intelligence
5. You should now see Meta KPIs and campaign data

### Phase 3: Verify Agent Outputs (After Backend Deployed)

**Step 1**: AI Services Setup
1. GitHub Secrets must have at least one of:
   - `OPENAI_API_KEY` (GPT-4 recommended)
   - `GEMINI_API_KEY` (free tier available)
   - `ANTHROPIC_API_KEY`

2. Add to GitHub Secrets if not already present

**Step 2**: Trigger Credential Seeding Again
Same as Phase 2, Step 3 - this will seed all credentials including AI keys

**Step 3**: Test Agent Outputs
1. Go to frontend → Intelligence → AI Analysis
2. Click "Generate Suggestions" for a campaign
3. Backend will:
   - Fetch Meta campaign data
   - Call AI service with campaign metrics
   - Return agent analysis and recommendations
4. Results should appear in ~5-10 seconds

### Phase 4: Enable All Intelligence Features

After backend is deployed and credentials seeded, all these become visible:

| Feature | Endpoint | Status |
|---------|----------|--------|
| Meta KPIs | `/api/meta/insights` | ✅ Ready |
| Campaign Analysis | `/api/meta/campaigns` | ✅ Ready |
| AI Suggestions | `/api/ai/suggestions` | ✅ Ready |
| Campaign Intelligence | `/api/ai/analyze-campaign` | ✅ Ready |
| Revenue KPIs | `/api/kpis` | ✅ Ready |
| Financial Summary | `/api/financials/summary` | ✅ Ready |
| Lead Traceability | `/api/traceability/funnel` | ✅ Ready |

## Troubleshooting

### "Backend returning 404"
- Render service not created yet
- Action: Follow Phase 1, Step 1-2

### "Integrations show 'disconnected' for Meta"
- Credentials not seeded
- Action: Follow Phase 2, Step 2-3

### "Meta data shows but no AI suggestions"
- AI credentials not set
- Action: Follow Phase 3, Step 1-2

### "Meta data shows but outdated"
- Cache timeout
- Action: Refresh page, or adjust cache settings in Dashboard page

### "Deploy workflow fails on Vercel"
- Missing Vercel secrets
- Action: Add `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` to GitHub Secrets

## What's Deployed & Ready

✅ **Code**: All routes, credential parsing, and AI integration completed
✅ **Tests**: 132 backend tests pass, all green
✅ **Database**: Schema complete with RLS policies
✅ **Frontend**: Dashboard UI components ready
✅ **Workflows**: CI/CD fully fixed and functional

## Next Actions (In Order)

1. **Deploy backend to Render** (15 min) - Phase 1
2. **Add Meta credentials** (5 min) - Phase 2
3. **Add AI credentials** (5 min) - Phase 3
4. **Verify live dashboard** (5 min) - See Meta data and agent outputs

**Total time to live**: ~30 minutes
