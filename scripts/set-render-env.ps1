#!/usr/bin/env pwsh
# Set Render environment variables for nuvanx-backend
# Usage:
#   1. Go to https://dashboard.render.com/u/settings#api-keys
#   2. Create an API key
#   3. Run: .\scripts\set-render-env.ps1 -ApiKey "rnd_YOUR_API_KEY"
#
# Alternative: set them manually in Dashboard → nuvanx-backend → Environment

param(
    [Parameter(Mandatory=$true)]
    [string]$ApiKey
)

$ErrorActionPreference = "Stop"

# --- Find the service ID ---
Write-Host "`n=== Finding nuvanx-backend service ===" -ForegroundColor Cyan
$headers = @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
$services = Invoke-RestMethod -Uri "https://api.render.com/v1/services?limit=50" -Headers $headers
$svc = $services | Where-Object { $_.service.name -eq "nuvanx-backend" } | Select-Object -First 1
if (-not $svc) {
    Write-Error "Service 'nuvanx-backend' not found. Check your Render dashboard."
    exit 1
}
$serviceId = $svc.service.id
Write-Host "Found service: $serviceId ($($svc.service.name))" -ForegroundColor Green

# --- Environment variables to set ---
$envVars = @(
    @{ key = "NODE_ENV";                value = "production" }
    @{ key = "PORT";                    value = "10000" }
    # SECURITY: Never hardcode secrets here. Pass them as parameters or read from a local .env file.
    # Generate JWT_SECRET: openssl rand -hex 32
    @{ key = "JWT_SECRET";              value = $env:JWT_SECRET }
    # Generate ENCRYPTION_KEY: openssl rand -hex 32
    @{ key = "ENCRYPTION_KEY";          value = $env:ENCRYPTION_KEY }
    # Supabase → Project Settings → Database → Connection Pooling (Transaction mode, port 6543)
    @{ key = "DATABASE_URL";            value = $env:DATABASE_URL }
    # Space-separated or comma-separated Vercel frontend URL(s) + localhost for dev
    @{ key = "FRONTEND_URL";            value = $env:FRONTEND_URL }
    # Supabase → Project Settings → API
    @{ key = "SUPABASE_URL";            value = $env:SUPABASE_URL }
    @{ key = "SUPABASE_ANON_KEY";       value = $env:SUPABASE_ANON_KEY }
    @{ key = "SUPABASE_SERVICE_ROLE_KEY"; value = $env:SUPABASE_SERVICE_ROLE_KEY }
    # Supabase → Project Settings → API → JWT Settings → JWT Secret
    @{ key = "SUPABASE_JWT_SECRET";     value = $env:SUPABASE_JWT_SECRET }
    @{ key = "SUPABASE_FIGMA_URL";      value = $env:SUPABASE_FIGMA_URL }
    @{ key = "SUPABASE_FIGMA_ANON_KEY"; value = $env:SUPABASE_FIGMA_ANON_KEY }
    @{ key = "SUPABASE_FIGMA_SERVICE_ROLE"; value = $env:SUPABASE_FIGMA_SERVICE_ROLE }
)

# --- Set env vars via Render API ---
Write-Host "`n=== Setting $($envVars.Count) environment variables ===" -ForegroundColor Cyan
$body = $envVars | ConvertTo-Json
$result = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars" -Method PUT -Headers $headers -Body $body -ContentType "application/json"
Write-Host "Set $($result.Count) environment variables" -ForegroundColor Green

# --- Trigger deploy ---
Write-Host "`n=== Triggering deploy ===" -ForegroundColor Cyan
$deploy = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys" -Method POST -Headers $headers -Body '{"clearCache":"do_not_clear"}' -ContentType "application/json"
Write-Host "Deploy triggered: $($deploy.deploy.id) — status: $($deploy.deploy.status)" -ForegroundColor Green

# --- Create deploy hook for GitHub Actions ---
Write-Host "`n=== Getting deploy hook URL ===" -ForegroundColor Yellow
Write-Host "Go to: https://dashboard.render.com/web/$serviceId/settings#deploy-hook"
Write-Host "Copy the deploy hook URL and set it as a GitHub secret:"
Write-Host "  gh secret set RENDER_DEPLOY_HOOK_URL --body `"<HOOK_URL>`""

Write-Host "`n=== Done! ===" -ForegroundColor Green
Write-Host "Backend will be live at: https://nuvanx-backend.onrender.com"
Write-Host "Health check: https://nuvanx-backend.onrender.com/health"
