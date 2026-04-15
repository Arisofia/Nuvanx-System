# Nuvanx System

Operational CRM/integrations/AI web application with an Express backend and React frontend.

This README is intentionally status-first and non-marketing.

## Current State

### Implemented
- Backend API server with routes for auth, credentials, integrations, leads, dashboard, and AI.
- Frontend application with routes:
  - /dashboard (Dashboard)
  - /operativo (Operativo)
  - /crm (CRM)
  - /live (Live)
  - /integrations (Integrations)
  - /ai (AI Layer)
- Encrypted credential storage path in backend models/services.
- Figma mapping validation foundation:
  - docs/figma-component-map.json
  - scripts/validate-figma-mapping.mjs
  - CI workflow checks.

### Partial
- In-memory fallback still exists for non-production development/testing paths in several backend models.
- Integration analytics endpoints depend on additional metadata and external credentials.

### Production Guardrails
- In production, backend startup requires a valid DB connection string and exits fast when PostgreSQL is unavailable.
- Backend-native auth persists users in PostgreSQL in production-capable paths.

### Mock / Demo
- frontend/src/pages/Playbooks.jsx content is demo data and explicitly labeled in UI.
- frontend/src/pages/LiveDashboard.jsx chart/feed sections are placeholder/mock and explicitly labeled.
- Some CRM shortcut actions are placeholder actions in UI.

### Missing
- Full Figma node-level verification against Figma API.
- Durable user/auth storage path for backend-native auth in production.
- Full playbook execution backend and execution tracking.

## Project Structure

- backend/: Express API and model/service layers
- frontend/: React + Vite UI
- docs/: readiness, truth matrix, Figma validation docs
- scripts/: repository utility scripts

## Development

### Backend
1. cd backend
2. npm install
3. configure .env from .env.example
4. npm run dev

### Frontend
1. cd frontend
2. npm install
3. configure .env from .env.example
4. npm run dev

## Validation

### Figma Mapping Validation
From repository root:
- node scripts/validate-figma-mapping.mjs

From frontend folder:
- npm run validate:figma

The validator checks route/file mapping structure. It does not yet validate node IDs against Figma API.

## Key Documentation
- docs/repo-forensic-audit.md
- docs/data-truth-matrix.md
- docs/figma-validation-audit.md
- docs/figma-validation-spec.md
- docs/backend-readiness-gap.md
- docs/agents-and-integrations-architecture.md
- docs/ci-cd-status.md
- docs/production-readiness-gap.md
- docs/final-execution-report.md
- docs/final-cleanup-and-readiness-report.md
