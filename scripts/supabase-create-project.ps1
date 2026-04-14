param(
    [Parameter(Mandatory = $true)]
    [string]$SupabaseAccessToken,

    [string]$ProjectName = "nuvanx-prod",
    [string]$OrgId = "okvvvqdlqduvymjyulps",
    [string]$Region = "eu-west-3",
    [string]$DbPassword
)

$ErrorActionPreference = "Stop"

function New-StrongPassword {
    param([int]$Length = 28)

    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}"
    -join ((1..$Length) | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
}

if ([string]::IsNullOrWhiteSpace($DbPassword)) {
    $DbPassword = New-StrongPassword
}

Write-Host "Creating Supabase project '$ProjectName' in org '$OrgId' ($Region)..."

$env:SUPABASE_ACCESS_TOKEN = $SupabaseAccessToken

npx supabase projects create $ProjectName --org-id $OrgId --db-password "$DbPassword" --region $Region --yes | Out-Host

if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI failed while creating project. Exit code: $LASTEXITCODE"
}

Write-Host "Project creation request submitted."
Write-Host "Database password (store it safely): $DbPassword"
Write-Host "Next: run scripts/supabase-cli-setup.ps1 to link and apply database.sql"