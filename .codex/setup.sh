#!/usr/bin/env bash
set -euo pipefail

# Codex cloud setup script for Nuvanx-System
# Installs deterministic dependencies for root, backend, and frontend.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm ci
npm --prefix backend ci
npm --prefix frontend ci --include=dev

echo "[codex-setup] Dependencies installed for root/backend/frontend."
