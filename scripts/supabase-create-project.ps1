param(
    [Parameter(Mandatory = $true)]
    [string]$SupabaseAccessToken,

    [string]$ProjectName = "nuvanx-prod",
    [string]$OrgId = "okvvvqdlqduvymjyulps",
    [string]$Region = "eu-west-3",
    [SecureString]$DbPassword
)

$ErrorActionPreference = "Stop"

function ConvertTo-PlainText {
    param([Parameter(Mandatory = $true)][SecureString]$SecureValue)

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function New-StrongPassword {
    param([int]$Length = 28)

    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}"
    -join ((1..$Length) | ForEach-Object { $chars[(Get-Random -Minimum 0 -Maximum $chars.Length)] })
}

$generatedPassword = $false
$plainDbPassword = $null

if ($null -eq $DbPassword) {
    $plainDbPassword = New-StrongPassword
    $DbPassword = ConvertTo-SecureString -String $plainDbPassword -AsPlainText -Force
    $generatedPassword = $true
}
else {
    $plainDbPassword = ConvertTo-PlainText -SecureValue $DbPassword
}

Write-Host "Creating Supabase project '$ProjectName' in org '$OrgId' ($Region)..."

$env:SUPABASE_ACCESS_TOKEN = $SupabaseAccessToken

npx supabase projects create $ProjectName --org-id $OrgId --db-password "$plainDbPassword" --region $Region --yes | Out-Host

if ($LASTEXITCODE -ne 0) {
    throw "Supabase CLI failed while creating project. Exit code: $LASTEXITCODE"
}

Write-Host "Project creation request submitted."
if ($generatedPassword) {
    Write-Host "Database password (store it safely): $plainDbPassword"
}
else {
    Write-Host "Database password was provided securely via SecureString parameter."
}
Write-Host "Next: run scripts/supabase-cli-setup.ps1 to link and apply database.sql"