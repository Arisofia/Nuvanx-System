#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ssvvuuysgxyqvmovrlvk}"
CANONICAL_FRONTEND_URL="${CANONICAL_FRONTEND_URL:-https://frontend-arisofias-projects-c2217452.vercel.app}"

required_bins=(node npm npx rg)
for bin in "${required_bins[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[error] Missing required command: $bin" >&2
    exit 1
  fi
done

if ! command -v supabase >/dev/null 2>&1; then
  echo "[warn] Supabase CLI not found globally. Commands will run through npx when possible."
fi

echo "== Nuvanx production setup verifier =="
echo "project_ref=$SUPABASE_PROJECT_REF"
echo "frontend_url=$CANONICAL_FRONTEND_URL"

echo
echo "[1/7] Checking local migration coverage for agent_outputs JSON fields"
if rg -n "ADD COLUMN .*output|output\s+JSONB|metadata\s+JSONB" supabase/migrations >/dev/null; then
  echo "[ok] agent_outputs output/metadata columns are represented in migrations."
else
  echo "[error] Missing migration coverage for agent_outputs output/metadata columns." >&2
  exit 1
fi

echo
echo "[2/7] Checking local migration coverage for E2E user cleanup"
if rg -n "e2e-.*@nuvanx\.test|DELETE FROM .*users" supabase/migrations >/dev/null; then
  echo "[ok] Found migration entries for E2E cleanup."
else
  echo "[warn] Could not find explicit E2E cleanup migration in repo."
fi

echo
echo "[3/7] Building frontend"
npm run build

echo
echo "[4/7] Validating Vercel API rewrite"
if rg -n "supabase\.co/functions/v1/api|/api/(.*)" frontend/vercel.json >/dev/null; then
  echo "[ok] frontend/vercel.json contains Supabase Edge Function API rewrite."
else
  echo "[error] frontend/vercel.json is missing expected /api rewrite." >&2
  exit 1
fi

echo
echo "[5/7] Printing exact secret/env setup commands"
cat <<CMDS
# Supabase (required)
npx --yes supabase secrets set ENCRYPTION_KEY='<same-key-used-by-node-backend>' --project-ref "$SUPABASE_PROJECT_REF"

# Optional but recommended validation
npx --yes supabase secrets list --project-ref "$SUPABASE_PROJECT_REF"

# Edge Function deploy
npx --yes supabase functions deploy api  --project-ref "$SUPABASE_PROJECT_REF"

# Vercel (required frontend env for auth)
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production

# Promote deployment (if alias has not been promoted yet)
vercel promote dpl_4YqxemmXtAqgWUp937LDi7EvCTAb
CMDS

echo
echo "[6/7] Optional remote checks (requires authenticated CLI)"
cat <<'CHECKS'
# Confirm deployed edge function list/version metadata
npx --yes supabase functions list --project-ref ssvvuuysgxyqvmovrlvk

# Confirm table state from SQL editor or psql tunnel:
# select count(*) as settlements, sum(net_revenue)::numeric(12,2) as total_revenue from financial_settlements;
# select count(*) from agent_runs;
# select count(*) from doctoralia_patients;
# select count(*) from meta_cache;
CHECKS

echo
echo "[7/7] Done. Execute the commands above after logging into Supabase/Vercel CLIs."

