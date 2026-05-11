#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Limpiando artefactos de Nuvanx-System..."

# ── 1. Build outputs ──────────────────────────────────────────────────────────
rm -rf frontend/dist
rm -rf frontend/.vite

# ── 2. node_modules (raíz + subproyectos) ────────────────────────────────────
rm -rf node_modules
rm -rf backend/node_modules
rm -rf frontend/node_modules

# ── 3. Test & coverage outputs ───────────────────────────────────────────────
rm -rf frontend/test-results
rm -rf frontend/playwright-report
rm -rf frontend/coverage
rm -rf backend/coverage

# ── 4. Reports generados por scripts ─────────────────────────────────────────
rm -rf reports

# ── 5. Caches ─────────────────────────────────────────────────────────────────
rm -rf .cache
rm -rf frontend/.cache
rm -rf .turbo
rm -rf .vercel/cache

# ── 6. Logs ───────────────────────────────────────────────────────────────────
find . -name "*.log" -not -path "./.git/*" -type f -delete

# ── 7. Supabase local DB data (opcional) ──────────────────────────────────────
# rm -rf supabase/.branches
# rm -rf supabase/data

echo ""
echo "✓  Limpieza completa."
echo "   Para reinstalar dependencias: npm run install:all"
echo "   Para levantar el frontend:    npm run dev:frontend"
echo "   Para levantar el backend:     npm run dev:backend"
