$ErrorActionPreference = 'Continue'
$svcId = "4c5c7c8d-ff9d-4f35-9477-705ab3a7638e"
$envFile = Join-Path $PSScriptRoot "..\backend\.env"
$pushed = 0
$skippedKeys = @()

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^([A-Z_][A-Z0-9_]*)=(.+)$') {
        $key = $Matches[1]
        $val = $Matches[2]
        if ($val -notmatch 'your-|YOUR-|PASTE_YOUR|placeholder|here' -and $val.Length -gt 2) {
            railway vars --set "${key}=${val}" --service $svcId --skip-deploys 2>&1 | Out-Null
            Write-Host "  OK  $key" -ForegroundColor Green
            $pushed++
        } else {
            $skippedKeys += $key
        }
    }
}

# Also set NODE_ENV=production for Railway
railway vars --set "NODE_ENV=production" --service $svcId --skip-deploys 2>&1 | Out-Null
Write-Host "  OK  NODE_ENV=production" -ForegroundColor Green
$pushed++

Write-Host ""
Write-Host "Pushed: $pushed vars" -ForegroundColor Cyan
if ($skippedKeys.Count -gt 0) {
    Write-Host "Skipped (placeholder/empty): $($skippedKeys -join ', ')" -ForegroundColor Yellow
}
