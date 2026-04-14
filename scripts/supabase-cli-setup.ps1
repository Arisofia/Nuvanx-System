param(
    [Parameter(Mandatory = $true)]
    [string]$SupabaseAccessToken,

    [Parameter(Mandatory = $true)]
    [SecureString]$DbPassword,

    [string]$ProjectRef = "sddviizcgheusvwqpthm"
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

$repoRoot = Split-Path -Parent $PSScriptRoot
$sqlFile = Join-Path $repoRoot "frontend/src/lib/supabase/database.sql"

if (-not (Test-Path $sqlFile)) {
    throw "No se encontro el archivo SQL en: $sqlFile"
}

Write-Host "[1/5] Verificando Supabase CLI via npx..."
npx supabase --version | Out-Host

Write-Host "[2/5] Inicializando carpeta supabase local (si no existe)..."
if (-not (Test-Path (Join-Path $repoRoot "supabase"))) {
    Push-Location $repoRoot
    npx supabase init | Out-Host
    Pop-Location
}

Write-Host "[3/5] Login con token..."
Push-Location $repoRoot
npx supabase login --token $SupabaseAccessToken | Out-Host

Write-Host "[4/5] Enlazando proyecto remoto..."
$plainDbPassword = ConvertTo-PlainText -SecureValue $DbPassword
npx supabase link --project-ref $ProjectRef --password $plainDbPassword | Out-Host

Write-Host "[5/5] Aplicando schema desde database.sql al proyecto vinculado..."
Get-Content -Raw $sqlFile | npx supabase db query | Out-Host

Write-Host "Listo. Schema aplicado en el proyecto Supabase: $ProjectRef"
Pop-Location