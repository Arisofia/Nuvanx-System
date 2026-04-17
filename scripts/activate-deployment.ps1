<#
.SYNOPSIS
  Activate the Nuvanx deployment pipeline (Render + Vercel + GitHub Secrets).

.DESCRIPTION
  This script automates the steps needed to fully activate CI/CD deploys.
  Run each section interactively — you'll need tokens from Render and Vercel dashboards.

.NOTES
  Prerequisites:
    - gh CLI authenticated  ($env:LOCALAPPDATA\gh-cli\bin\gh.exe)
    - vercel CLI installed   (npm i -g vercel)
    - Node.js 20+

.EXAMPLE
  .\scripts\activate-deployment.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ROOT   = Split-Path $PSScriptRoot -Parent
$GH     = "$env:LOCALAPPDATA\gh-cli\bin\gh.exe"
$REPO   = 'Arisofia/Nuvanx-System'

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Nuvanx Deployment Activation Script"    -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — Render: Set environment variables via dashboard
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "STEP 1: Render environment variables" -ForegroundColor Yellow
Write-Host @"

Go to: https://dashboard.render.com → nuvanx-backend → Environment
Set these environment variables (copy values from backend/.env):

  NODE_ENV               = production
  PORT                   = 10000
  JWT_SECRET             = 4b8a484bc5f61ec5533b990fff657922dce43fccd21d7136cdbbfefdaa3ac9db
  ENCRYPTION_KEY         = e04756b46dacf0e74233cf41a02103f27fdadcbd72c83153be7d7ec5e3ac46a9
  DATABASE_URL           = postgresql://postgres.ssvvuuysgxyqvmovrlvk:n5SNU4AYoEmuJ6RXiVqMchLCxOWlwfeB@aws-1-eu-central-1.pooler.supabase.com:6543/postgres
  SUPABASE_URL           = https://ssvvuuysgxyqvmovrlvk.supabase.co
  SUPABASE_ANON_KEY      = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTIxOTYsImV4cCI6MjA5MTc2ODE5Nn0.5VslHXbyEidKqZassAZCBLeUYd2_MWSmOHl3fFrvTRo
  SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE5MjE5NiwiZXhwIjoyMDkxNzY4MTk2fQ.QX29reZp-UyOQAh67CTph-LLmQILolPmo1lLZVrpYU8
  SUPABASE_JWT_SECRET    = N0lw/BUxHOThfkT5jQkS68zj6fkVUpr0DSmNm6cAnrRR0Mjq8ftwB4KMGgw9G07j5Z9ZrbC1l921fy7owEu6aQ==
  SUPABASE_FIGMA_URL     = https://zpowfbeftxexzidlxndy.supabase.co
  SUPABASE_FIGMA_ANON_KEY = (from Figma project settings)
  SUPABASE_FIGMA_SERVICE_ROLE = (from Figma project settings)
  FRONTEND_URL           = (set after Vercel deploy — e.g. https://nuvanx.vercel.app)

After setting vars, Render will auto-redeploy. Wait for the deploy to complete.
"@

Read-Host "`nPress Enter when Render env vars are set..."

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Render: Get deploy hook URL and set as GitHub secret
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`nSTEP 2: Render deploy hook → GitHub secret" -ForegroundColor Yellow
Write-Host @"

Go to: https://dashboard.render.com → nuvanx-backend → Settings → Deploy Hook
Copy the deploy hook URL (looks like: https://api.render.com/deploy/srv-xxx?key=yyy)
"@

$renderHook = Read-Host "Paste the Render deploy hook URL"
if ($renderHook -and $renderHook -match '^https://api\.render\.com/deploy/') {
    & $GH secret set RENDER_DEPLOY_HOOK_URL --repo $REPO --body $renderHook
    Write-Host "  ✓ RENDER_DEPLOY_HOOK_URL set as GitHub secret" -ForegroundColor Green
} else {
    Write-Host "  ⚠ Skipped — invalid or empty URL" -ForegroundColor DarkYellow
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Vercel: Link project and set env vars
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`nSTEP 3: Vercel project setup" -ForegroundColor Yellow
Write-Host @"

Go to: https://vercel.com/account/tokens → Create a new token (name: nuvanx-deploy)
"@

$vercelToken = Read-Host "Paste your Vercel token"
if (-not $vercelToken) {
    Write-Host "  ⚠ No token — skipping Vercel steps" -ForegroundColor DarkYellow
} else {
    # Link Vercel project
    Write-Host "`n  Linking Vercel project..." -ForegroundColor Gray
    Push-Location "$ROOT\frontend"
    try {
        vercel link --yes --token $vercelToken 2>&1 | ForEach-Object { Write-Host "    $_" }

        # Read project.json to extract org ID and project ID
        $projectJson = Get-Content "$ROOT\frontend\.vercel\project.json" -Raw | ConvertFrom-Json
        $orgId     = $projectJson.orgId
        $projectId = $projectJson.projectId

        Write-Host "  ✓ Vercel project linked" -ForegroundColor Green
        Write-Host "    orgId:     $orgId"
        Write-Host "    projectId: $projectId"

        # Set Vercel env vars
        Write-Host "`n  Setting Vercel environment variables..." -ForegroundColor Gray

        $envVars = @{
            'VITE_API_URL'           = 'https://nuvanx-backend.onrender.com'
            'VITE_SUPABASE_URL'      = 'https://ssvvuuysgxyqvmovrlvk.supabase.co'
            'VITE_SUPABASE_ANON_KEY' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTIxOTYsImV4cCI6MjA5MTc2ODE5Nn0.5VslHXbyEidKqZassAZCBLeUYd2_MWSmOHl3fFrvTRo'
        }

        foreach ($kv in $envVars.GetEnumerator()) {
            # vercel env add writes to stdin
            $kv.Value | vercel env add $kv.Key production --token $vercelToken --yes 2>&1 | ForEach-Object { Write-Host "    $_" }
            Write-Host "    ✓ $($kv.Key)" -ForegroundColor Green
        }

        # Set GitHub secrets
        Write-Host "`n  Setting GitHub secrets..." -ForegroundColor Gray
        & $GH secret set VERCEL_TOKEN      --repo $REPO --body $vercelToken
        & $GH secret set VERCEL_ORG_ID     --repo $REPO --body $orgId
        & $GH secret set VERCEL_PROJECT_ID --repo $REPO --body $projectId
        Write-Host "  ✓ VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID set as GitHub secrets" -ForegroundColor Green

    } finally {
        Pop-Location
    }
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Validate backend health
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`nSTEP 4: Validate backend health" -ForegroundColor Yellow
Write-Host "  Checking https://nuvanx-backend.onrender.com/health ..." -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri 'https://nuvanx-backend.onrender.com/health' -UseBasicParsing -TimeoutSec 30
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✓ Backend is healthy (HTTP 200)" -ForegroundColor Green
        Write-Host "    $($response.Content)" -ForegroundColor Gray
    } else {
        Write-Host "  ⚠ Unexpected status: $($response.StatusCode)" -ForegroundColor DarkYellow
    }
} catch {
    Write-Host "  ✗ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    → Wait 2-3 minutes for Render cold start, then re-run this step" -ForegroundColor DarkYellow
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — Update FRONTEND_URL on Render
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`nSTEP 5: Update FRONTEND_URL on Render" -ForegroundColor Yellow
Write-Host @"

After Vercel deploys, update Render env var:
  FRONTEND_URL = https://<your-vercel-domain>

This sets the CORS origin so the frontend can reach the backend.
"@

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Trigger deploy
# ─────────────────────────────────────────────────────────────────────────────
Write-Host "`nSTEP 6: Trigger a deploy" -ForegroundColor Yellow
$trigger = Read-Host "Trigger deploy workflow now? (y/n)"
if ($trigger -eq 'y') {
    & $GH workflow run deploy.yml --repo $REPO --ref main
    Write-Host "  ✓ Deploy workflow triggered" -ForegroundColor Green
    Write-Host "  Check status: gh run list --repo $REPO --limit 4" -ForegroundColor Gray
} else {
    Write-Host "  Skipped — push to main to trigger automatically" -ForegroundColor Gray
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Activation complete!" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host @"
Checklist:
  [ ] Render env vars set
  [ ] Render deploy hook → RENDER_DEPLOY_HOOK_URL GitHub secret
  [ ] Vercel project linked
  [ ] Vercel env vars set (VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
  [ ] VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID → GitHub secrets
  [ ] Backend /health returns 200
  [ ] FRONTEND_URL updated on Render (CORS)
  [ ] Deploy workflow runs both jobs successfully
"@
