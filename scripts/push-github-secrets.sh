#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# push-github-secrets.sh
# Sube todos los secrets de backend/.env a GitHub Actions
#
# USO:
#   ARISOFIA_TOKEN=ghp_TuTokenAqui bash scripts/push-github-secrets.sh
#
# Requiere: gh CLI instalado (brew install gh)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="Arisofia/Nuvanx-System"
ENV_FILE="$(dirname "$0")/../backend/.env"

if [[ -z "${ARISOFIA_TOKEN:-}" ]]; then
  echo "❌  Falta ARISOFIA_TOKEN. Ejecúta así:"
  echo "    ARISOFIA_TOKEN=ghp_TuToken bash scripts/push-github-secrets.sh"
  exit 1
fi

export GH_TOKEN="$ARISOFIA_TOKEN"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Subiendo secrets a $REPO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Arrays de variables a excluir (comentarios, rutas locales, valores vacíos)
EXCLUDE=(
  "NODE_ENV"
  "PORT"
  "JWT_EXPIRES_IN"
  "FRONTEND_URL"
  "GOOGLE_APPLICATION_CREDENTIALS"
  "SUPABASE_DATABASE_KEY"
  "ANTHROPIC_API_KEY_OLD"
  "GITHUB_TOKEN"
  "GITHUB_TOKEN_CLASSIC"
)

pass=0
skip=0
fail=0

while IFS= read -r line || [[ -n "$line" ]]; do
  # Ignorar comentarios y líneas vacías
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  [[ "$line" != *"="* ]] && continue

  KEY="${line%%=*}"
  VALUE="${line#*=}"

  # Ignorar si el valor está vacío
  [[ -z "$VALUE" ]] && { ((skip++)); continue; }

  # Ignorar variables de la lista de exclusión
  excluded=false
  for ex in "${EXCLUDE[@]}"; do
    [[ "$KEY" == "$ex" ]] && { excluded=true; break; }
  done
  $excluded && { ((skip++)); continue; }

  # Subir el secret
  if echo -n "$VALUE" | gh secret set "$KEY" --repo "$REPO" --body - 2>/dev/null; then
    echo "  ✅  $KEY"
    ((pass++))
  else
    echo "  ❌  $KEY (failed)"
    ((fail++))
  fi

done < "$ENV_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Resultado: ✅ $pass subidos | ⏭️  $skip omitidos | ❌ $fail fallidos"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
