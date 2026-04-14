# Agents and Integrations Architecture

Date: 2026-04-14

## Current AI Layer in Code
- Frontend entrypoint: frontend/src/pages/AILayer.jsx
- Backend routes: backend/src/routes/ai.js
- Implemented operations:
  - /api/ai/generate
  - /api/ai/analyze-campaign
  - /api/ai/suggestions
- Provider resolution: OpenAI/Gemini based on per-user credential vault, with env-var fallbacks.

Reality check:
- This is API-proxied generation/analysis, not autonomous multi-agent orchestration.

## Current Integrations in Code
- Supported service catalog in backend/src/models/integration.js and frontend/src/hooks/useIntegrations.js:
  - meta
  - google-calendar
  - google-gmail
  - whatsapp
  - github
  - openai
  - gemini
  - hubspot
- Credential handling:
  - encrypted at rest via backend/src/services/encryption.js
  - access through backend/src/models/credential.js
- Validation endpoints:
  - /api/integrations/:service/test
  - /api/integrations/validate-all

## Real vs Shallow/Test-Only
- Real in code:
  - encrypted credential storage
  - connect/test integration APIs
  - dashboard core metrics from leads/integrations models
  - AI proxy endpoints with provider selection
- Shallow or conditional:
  - trends depending on extra metadata (Meta adAccountId)
  - no inbound webhook processing loop for channels
  - no durable user auth storage in backend default path

## What "Agents" Can Mean Today
Reasonable interpretation today:
- task-focused API wrappers that consume existing endpoints and generate recommendations.
- no stateful planner/executor runtime in this repository yet.

## Forward-Looking Agent Architecture

### 1) Growth Agent
- Inputs: /api/dashboard/metrics, /api/dashboard/revenue-trend, /api/ai/suggestions
- Output: weekly growth actions and KPI deltas
- Needed next: persisted action log and acceptance workflow

### 2) Campaign Monitoring Agent
- Inputs: Meta/HubSpot trend APIs (when configured)
- Output: spend anomalies, conversion alerts
- Needed next: alert scheduler + threshold config store

### 3) CRM/Reactivation Agent
- Inputs: /api/leads stage/source data
- Output: reactivation cohorts and contact sequencing recommendations
- Needed next: execution endpoints for messaging/calendar steps

### 4) Reporting Agent
- Inputs: dashboard + integrations status + lead lifecycle
- Output: executive summary markdown/PDF payload
- Needed next: report persistence/versioning and export job runner

### 5) Content Agent
- Inputs: campaign context + lead segments
- Output: generated copy variants via /api/ai/generate
- Needed next: approval queue, prompt templates, experiment tracking

## Minimal Structural Recommendations
- Add a small backend agent orchestration layer (job + run history table).
- Store agent outputs as records with status and reviewer decision.
- Gate all outbound actions behind explicit user approval until execution APIs are mature.
