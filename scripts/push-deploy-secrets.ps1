<#
.SYNOPSIS
  Push deploy-related secrets from backend/.env to GitHub Actions.

.DESCRIPTION
  Reads backend/.env, filters to the deploy-critical secrets, and pushes
  them to GitHub repo secrets via the gh CLI. Also handles the 5 CI/CD
  deploy secrets (RENDER_*, VERCEL_*) which are prompted interactively
  if not already in .env.

.EXAMPLE
  # Set your GitHub PAT first:
  $env:GH_TOKEN = "ghp_YourTokenHere"
  .\scripts\push-deploy-secrets.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$REPO = "Arisofia/Nuvanx-System"
$ENV_FILE = Join-Path $PSScriptRoot "..\backend\.env"

# ── Verify gh CLI ────────────────────────────────────────────────────────────
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "gh CLI not found. Install: winget install --id GitHub.cli"
    exit 1
}

if (-not $env:GH_TOKEN) {
    Write-Host "`n❌  GH_TOKEN not set. Run:`n    `$env:GH_TOKEN = 'ghp_YourToken'" -ForegroundColor Red
    Write-Host "    Then re-run this script.`n"
    exit 1
}

# ── Secrets to push from .env ────────────────────────────────────────────────
# Only these secrets are sent to GitHub. Local-only vars are excluded.
$INCLUDE = @(
    'JWT_SECRET'
    'ENCRYPTION_KEY'
    'DATABASE_URL'
    'SUPABASE_URL'
    'SUPABASE_ANON_KEY'
    'SUPABASE_SERVICE_ROLE_KEY'
    'SUPABASE_JWT_SECRET'
    'SUPABASE_FIGMA_URL'
    'SUPABASE_FIGMA_ANON_KEY'
    'SUPABASE_FIGMA_SERVICE_ROLE'
    'META_ACCESS_TOKEN'
    'META_AD_ACCOUNT_ID'
    'META_APP_SECRET'
    'META_VERIFY_TOKEN'
    'WHATSAPP_ACCESS_TOKEN'
    'WHATSAPP_PHONE_NUMBER_ID'
    'OPENAI_API_KEY'
    'GEMINI_API_KEY'
    'GITHUB_PAT'
    'RESEND_API_KEY'
    'SENTRY_DSN'
    'GOOGLE_CLIENT_ID'
    'GOOGLE_CLIENT_SECRET'
    'GOOGLE_REDIRECT_URI'
    'WEBHOOK_ADMIN_USER_ID'
)

# ── CI/CD deploy secrets (prompted if not in .env) ──────────────────────────
$DEPLOY_SECRETS = @(
    'RENDER_API_KEY'
    'RENDER_SERVICE_ID'
    'VERCEL_TOKEN'
    'VERCEL_ORG_ID'
    'VERCEL_PROJECT_ID'
)

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Pushing secrets to $REPO" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan

$pass = 0; $skip = 0; $fail = 0

# ── Parse .env ───────────────────────────────────────────────────────────────
$envVars = @{}
if (Test-Path $ENV_FILE) {
    Get-Content $ENV_FILE | ForEach-Object {
        $line = $_.Trim()
        if ($line -match '^[A-Z_]+=.+$') {
            $parts = $line -split '=', 2
            $envVars[$parts[0]] = $parts[1]
        }
    }
} else {
    Write-Warning "backend/.env not found at $ENV_FILE"
}

# ── Push .env secrets ────────────────────────────────────────────────────────
foreach ($key in $INCLUDE) {
    $val = $envVars[$key]
    if (-not $val -or $val -match 'PASTE_YOUR|YOUR-') {
        $skip++
        continue
    }
    try {
        $val | gh secret set $key --repo $REPO 2>$null
        Write-Host "  ✅  $key" -ForegroundColor Green
        $pass++
    } catch {
        Write-Host "  ❌  $key (failed)" -ForegroundColor Red
        $fail++
    }
}

# ── Deploy secrets (prompt if missing) ───────────────────────────────────────
Write-Host "`n── CI/CD Deploy Secrets ──────────────────────────" -ForegroundColor Yellow

foreach ($key in $DEPLOY_SECRETS) {
    $val = $envVars[$key]
    if (-not $val -or $val -match 'PASTE_YOUR|YOUR-') {
        Write-Host "  $key not in .env — enter value (or press Enter to skip):" -ForegroundColor Yellow -NoNewline
        $val = Read-Host " "
        if (-not $val) {
            Write-Host "  ⏭️   $key (skipped)" -ForegroundColor DarkGray
            $skip++
            continue
        }
    }
    try {
        $val | gh secret set $key --repo $REPO 2>$null
        Write-Host "  ✅  $key" -ForegroundColor Green
        $pass++
    } catch {
        Write-Host "  ❌  $key (failed)" -ForegroundColor Red
        $fail++
    }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Result: ✅ $pass pushed | ⏭️  $skip skipped | ❌ $fail failed" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan
