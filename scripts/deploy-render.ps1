<#
.SYNOPSIS
    Deploys the nuvanx-backend to Render.com using the Render API.

.DESCRIPTION
    1. Reads RENDER_API_KEY from backend/.env (or -ApiKey param)
    2. Looks up the nuvanx-backend service on Render
    3. Pushes all required env vars from backend/.env
    4. Triggers a deploy and polls until success/failure

.PARAMETER ApiKey
    Render API key (rnd_...). If omitted, reads RENDER_API_KEY from backend/.env.

.PARAMETER ServiceName
    Render service name to deploy. Default: nuvanx-backend

.EXAMPLE
    .\scripts\deploy-render.ps1
    .\scripts\deploy-render.ps1 -ApiKey rnd_xxxxxx
#>
param(
    [string]$ApiKey = "",
    [string]$ServiceName = "nuvanx-backend"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root "backend\.env"

# ── 1. Load .env into hashtable ─────────────────────────────────────────────
$envVars = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match "^[^#].*=.*" } | ForEach-Object {
        $parts = $_ -split "=", 2
        $envVars[$parts[0].Trim()] = $parts[1].Trim()
    }
}

# ── 2. Resolve API key ───────────────────────────────────────────────────────
if (-not $ApiKey) { $ApiKey = $envVars["RENDER_API_KEY"] }
if (-not $ApiKey) {
    Write-Error @"
RENDER_API_KEY not found. Either:
  - Add RENDER_API_KEY=rnd_... to backend/.env
  - Or pass: .\scripts\deploy-render.ps1 -ApiKey rnd_...

Get your key at: https://dashboard.render.com/u/settings/api-keys
"@
    exit 1
}

$headers = @{ Authorization = "Bearer $ApiKey"; "Content-Type" = "application/json" }

Write-Host "Render Deploy — nuvanx-backend" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan

# ── 3. Find the service ──────────────────────────────────────────────────────
Write-Host "`n[1/4] Looking up service '$ServiceName' on Render..." -ForegroundColor Yellow
$servicesResp = Invoke-RestMethod -Uri "https://api.render.com/v1/services?limit=100" -Headers $headers -Method GET
$service = $servicesResp | Where-Object { $_.service.name -eq $ServiceName } | Select-Object -First 1

if (-not $service) {
    Write-Host ""
    Write-Host "Service '$ServiceName' not found on Render." -ForegroundColor Red
    Write-Host ""
    Write-Host "To create it for the first time:" -ForegroundColor Yellow
    Write-Host "  1. Go to https://dashboard.render.com/new/blueprint" -ForegroundColor White
    Write-Host "  2. Connect your GitHub repo: Arisofia/Nuvanx-System" -ForegroundColor White
    Write-Host "  3. Render will detect render.yaml and create 'nuvanx-backend' automatically" -ForegroundColor White
    Write-Host "  4. After creation, re-run this script to push env vars and deploy" -ForegroundColor White
    exit 1
}

$serviceId = $service.service.id
$serviceUrl = $service.service.serviceDetails.url
Write-Host "  Found: $serviceId  ($serviceUrl)" -ForegroundColor Green

# ── 4. Build env vars to push ────────────────────────────────────────────────
Write-Host "`n[2/4] Building env var payload..." -ForegroundColor Yellow

# Keys to push to Render (exclude local-only keys)
$keysToSync = @(
    "JWT_SECRET", "ENCRYPTION_KEY",
    "DATABASE_URL",
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET",
    "SUPABASE_FIGMA_URL", "SUPABASE_FIGMA_ANON_KEY", "SUPABASE_FIGMA_SERVICE_ROLE",
    "META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_APP_SECRET", "META_VERIFY_TOKEN",
    "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
    "OPENAI_API_KEY", "GEMINI_API_KEY",
    "GITHUB_PAT",
    "BCRYPT_ROUNDS", "JWT_EXPIRES_IN",
    "SENTRY_DSN", "RESEND_API_KEY", "EMAIL_FROM",
    "WEBHOOK_ADMIN_USER_ID", "ALLOW_SHARED_CREDENTIALS"
)

# Production overrides (not taken from local .env)
$productionOverrides = @{
    NODE_ENV     = "production"
    PORT         = "10000"
    FRONTEND_URL = "https://frontend-arisofias-projects-c2217452.vercel.app"
}

$envPayload = @()

foreach ($key in $keysToSync) {
    $val = $envVars[$key]
    if ($val) {
        $envPayload += @{ key = $key; value = $val }
        Write-Host "  + $key" -ForegroundColor DarkGray
    } else {
        Write-Host "  ~ $key (empty, skipping)" -ForegroundColor DarkYellow
    }
}

foreach ($kv in $productionOverrides.GetEnumerator()) {
    $envPayload += @{ key = $kv.Key; value = $kv.Value }
    Write-Host "  + $($kv.Key) [production override]" -ForegroundColor DarkGray
}

Write-Host "  Total: $($envPayload.Count) env vars" -ForegroundColor Green

# ── 5. Push env vars ─────────────────────────────────────────────────────────
Write-Host "`n[3/4] Pushing env vars to Render service..." -ForegroundColor Yellow
$body = $envPayload | ConvertTo-Json -Depth 3
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars" `
    -Headers $headers -Method PUT -Body $body | Out-Null
Write-Host "  Env vars pushed successfully" -ForegroundColor Green

# ── 6. Trigger deploy ────────────────────────────────────────────────────────
Write-Host "`n[4/4] Triggering deployment..." -ForegroundColor Yellow
$deployResp = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys" `
    -Headers $headers -Method POST -Body "{}" 
$deployId = $deployResp.id
Write-Host "  Deploy ID: $deployId" -ForegroundColor Green
Write-Host "  Track at:  https://dashboard.render.com/web/$serviceId/deploys/$deployId" -ForegroundColor Cyan

# ── 7. Poll deploy status ────────────────────────────────────────────────────
Write-Host "`nPolling deploy status (timeout: 10 min)..." -ForegroundColor Yellow
$maxWait = 600   # seconds
$waited  = 0
$interval = 10

do {
    Start-Sleep -Seconds $interval
    $waited += $interval
    try {
        $status = (Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys/$deployId" -Headers $headers -Method GET).status
    } catch {
        $status = "unknown"
    }
    $elapsed = "{0:mm\:ss}" -f [timespan]::fromseconds($waited)
    Write-Host "  [$elapsed] $status" -ForegroundColor DarkGray
} while ($status -notin @("live", "failed", "canceled") -and $waited -lt $maxWait)

Write-Host ""
if ($status -eq "live") {
    Write-Host "DEPLOY SUCCEEDED" -ForegroundColor Green
    Write-Host "  Backend URL: $serviceUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Meta webhook URL to register:" -ForegroundColor Yellow
    Write-Host "  $serviceUrl/api/webhooks/meta" -ForegroundColor White
    Write-Host "Verify token:" -ForegroundColor Yellow
    Write-Host "  $($envVars['META_VERIFY_TOKEN'])" -ForegroundColor White
} elseif ($status -eq "failed") {
    Write-Host "DEPLOY FAILED" -ForegroundColor Red
    Write-Host "  Check logs: https://dashboard.render.com/web/$serviceId/logs" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "Deploy status: $status (timed out waiting)" -ForegroundColor Yellow
    Write-Host "  Check: https://dashboard.render.com/web/$serviceId/deploys/$deployId" -ForegroundColor Cyan
}
