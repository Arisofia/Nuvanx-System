$ErrorActionPreference = 'Continue'

Set-Location "$PSScriptRoot\..\frontend"

$authPath = Join-Path $env:APPDATA 'com.vercel.cli\Data\auth.json'
if (!(Test-Path $authPath)) {
  throw "No se encontro auth de Vercel en $authPath"
}

$auth = Get-Content $authPath -Raw | ConvertFrom-Json
$token = $auth.token
if ([string]::IsNullOrWhiteSpace($token)) {
  throw "No se encontro token de Vercel en auth.json"
}

$envFile = "$PSScriptRoot\..\backend\.env"
if (!(Test-Path $envFile)) {
  throw "No se encontro backend/.env"
}

$map = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^[A-Za-z_][A-Za-z0-9_]*=') {
    $parts = $_ -split '=', 2
    if ($parts.Count -eq 2) {
      $map[$parts[0]] = $parts[1]
    }
  }
}

if (-not $map.ContainsKey('SUPABASE_URL') -or -not $map.ContainsKey('SUPABASE_ANON_KEY')) {
  throw "Faltan SUPABASE_URL o SUPABASE_ANON_KEY en backend/.env"
}

$targetVars = @{
  'VITE_SUPABASE_URL' = $map['SUPABASE_URL'].Trim()
  'VITE_SUPABASE_ANON_KEY' = $map['SUPABASE_ANON_KEY'].Trim()
  'VITE_API_URL' = "$($map['SUPABASE_URL'].Trim())/functions/v1/api"
}

$projectId = 'prj_IAOBlV17HeS22KuEfsdkDrGMV9Ze'
$teamId = 'team_R0GOR4jvw1c1gnyBRWYu32O7'
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

foreach ($key in $targetVars.Keys) {
  $body = @{
    key = $key
    value = $targetVars[$key]
    type = 'encrypted'
    target = @('production', 'preview', 'development')
  } | ConvertTo-Json -Depth 5

  Invoke-RestMethod -Method Post -Uri "https://api.vercel.com/v10/projects/$projectId/env?upsert=true&teamId=$teamId" -Headers $headers -Body $body | Out-Null
  Write-Output "VERCEL OK $key [production,preview,development]"
}

Write-Output 'SYNC COMPLETE'
