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
    @{ key = "JWT_SECRET";              value = "4b8a484bc5f61ec5533b990fff657922dce43fccd21d7136cdbbfefdaa3ac9db" }
    @{ key = "ENCRYPTION_KEY";          value = "e04756b46dacf0e74233cf41a02103f27fdadcbd72c83153be7d7ec5e3ac46a9" }
    @{ key = "DATABASE_URL";            value = "postgresql://postgres.ssvvuuysgxyqvmovrlvk:n5SNU4AYoEmuJ6RXiVqMchLCxOWlwfeB@aws-1-eu-central-1.pooler.supabase.com:6543/postgres" }
    @{ key = "FRONTEND_URL";            value = "https://frontend-gilt-rho-15.vercel.app,http://localhost:5173" }
    @{ key = "SUPABASE_URL";            value = "https://ssvvuuysgxyqvmovrlvk.supabase.co" }
    @{ key = "SUPABASE_ANON_KEY";       value = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NTkwMTQsImV4cCI6MjA2MDIzNTAxNH0.qkCPMBzJfOu2HzCF6OkTz0RLKtSfnFaDXRnONpSbvJo" }
    @{ key = "SUPABASE_SERVICE_ROLE_KEY"; value = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDY1OTAxNCwiZXhwIjoyMDYwMjM1MDE0fQ.X3BKBG3Gxljd29LMmZp3cGlKBnHNb8xSPJ7zUxJmjQw" }
    @{ key = "SUPABASE_JWT_SECRET";     value = "7PV9B5MxqJGMD9Gb3L5VJQzq5gNTJ0IijSlsT7eSH+3VEoVxLmWTFmA0Jb9lEkpGVMGlIwVFlXJJ3Vv6bY/Dw==" }
    @{ key = "SUPABASE_FIGMA_URL";      value = "https://ssvvuuysgxyqvmovrlvk.supabase.co" }
    @{ key = "SUPABASE_FIGMA_ANON_KEY"; value = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ2NTkwMTQsImV4cCI6MjA2MDIzNTAxNH0.qkCPMBzJfOu2HzCF6OkTz0RLKtSfnFaDXRnONpSbvJo" }
    @{ key = "SUPABASE_FIGMA_SERVICE_ROLE"; value = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnZ1dXlzZ3h5cXZtb3ZybHZrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NDY1OTAxNCwiZXhwIjoyMDYwMjM1MDE0fQ.X3BKBG3Gxljd29LMmZp3cGlKBnHNb8xSPJ7zUxJmjQw" }
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
