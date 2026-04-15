# Agents and Integrations Architecture

Date: 2026-04-14  
Last updated: 2026-04-15

> **Architecture honesty mandate.** This document describes the *intended* agent architecture and the *current* implementation reality side-by-side. No capability is overstated.

---

## Current AI Layer — What Is Actually Running

| Component | File | Status |
|---|---|---|
| AI frontend | `frontend/src/pages/AILayer.jsx` | Implemented — API-backed |
| AI routes | `backend/src/routes/ai.js` | Implemented |
| Content generation | `POST /api/ai/generate` | Implemented — synchronous LLM proxy |
| Campaign analysis | `POST /api/ai/analyze-campaign` | Implemented — synchronous LLM proxy |
| Optimization suggestions | `POST /api/ai/suggestions` | Implemented — builds prompt from real leads + integrations data |
| Background task execution | — | **Not implemented** |
| Autonomous web scraping | — | **Not implemented** |
| Automated data federation | — | **Not implemented** |
| Event-driven agent triggers | — | **Not implemented** |

**Current reality:** the AI layer is a synchronous LLM proxy. All three endpoints require a user-initiated HTTP request. There is no background scheduler, no event bus, and no autonomous execution occurring at any time.

Provider resolution order:
1. Per-user vault credential (OpenAI or Gemini) via `credential.js`
2. Server-level env var fallback (`OPENAI_API_KEY`, `GEMINI_API_KEY`)
3. 404 if neither is available

---

## Current Integrations — What Is Actually Wired

| Service | Connection | Data Read | Data Write | Webhooks |
|---|---|---|---|---|
| Meta (Facebook Ads) | Credential vault | Campaign metrics (`/api/dashboard/meta-trends`) | None | Not implemented |
| HubSpot | Credential vault | None yet | None | Not implemented |
| Google Calendar | Credential vault | None yet | None | Not implemented |
| Google Gmail | Credential vault | None yet | None | Not implemented |
| WhatsApp Business | Credential vault | None yet | None | Not implemented |
| OpenAI | Credential vault + env | LLM generation | N/A | N/A |
| Gemini | Credential vault + env | LLM generation | N/A | N/A |
| GitHub | Credential vault | None yet | None | N/A |

All credential storage is AES-256-GCM encrypted at rest (`backend/src/services/encryption.js`). Raw keys are never returned to the client after storage.

---

## Intended Agent Architecture — Design Phase

The following five agents are **designed but not implemented**. Each entry documents the specific infrastructure prerequisites that must exist before implementation can begin.

### 1. Market and Competition Intelligence Agent

**Purpose:** Aggregate unstructured external signals into competitor analysis matrices.

**Design:**
- Ingests unstructured text from third-party web scraping APIs (e.g., ScraperAPI, Apify) and social listening aggregation tools.
- Processes raw text through a vector embedding pipeline stored in Supabase `pgvector` (PostgreSQL extension).
- Outputs structured competitor data matrices surfaced on the `/ai` route.

**Prerequisites:**
- `pgvector` extension enabled in Supabase project.
- `embeddings` table: `(id, user_id, source_url, content_hash, embedding vector(1536), created_at)`.
- Approved access tokens for at least one web scraping API.
- Backend job runner (`/api/agents/market-intel/run` — not yet created).

**Current blockers:** No scraping API credentials; `pgvector` not enabled; no embedding pipeline.

---

### 2. Marketing and Content Generation Agent

**Purpose:** Generate advertising copy via LLMs and iteratively optimize based on live Meta campaign metrics.

**Design:**
- Reads real-time campaign performance from Meta Graph API (impressions, CTR, CPC, conversions).
- Generates ad copy variants via `POST /api/ai/generate`.
- Receives real-time campaign update events via secure webhook listener at `POST /api/integrations/meta/webhook`.
- Delivers generated content to distribution channels via AutoSend (email delivery for AI agents) or similar.

**Prerequisites:**
- Meta business verification approved (see External Blockers section).
- `ads_read` and `leads_retrieval` Graph API permissions granted.
- Webhook listener implemented at `backend/src/routes/integrations.js` (HTTP endpoint exists but webhook processing loop, signature verification, retry logic, and dead-letter queue are **not yet implemented**).
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` env vars set for HMAC verification.

**Current blockers:** Meta business verification pending; webhook loop not implemented; AutoSend integration not started.

---

### 3. Sales and CRM Follow-up Agent

**Purpose:** Autonomously read lead state changes and draft contextual follow-up emails via LLM.

**Design:**
- Bidirectional sync with HubSpot via OAuth 2.0 (acquire, store, auto-refresh tokens in `credentials` table).
- Reads lead stage transitions from the `leads` table (Supabase Postgres Changes or polling).
- Uses LLM to draft follow-up emails tailored to each lead's stage, source, and revenue potential.
- Queues drafts for human approval before sending (no autonomous outbound email without approval).

**Prerequisites:**
- HubSpot developer portal application approved (see External Blockers section).
- OAuth 2.0 implementation: `GET /api/integrations/hubspot/oauth/start` and `GET /api/integrations/hubspot/oauth/callback` endpoints — **not yet implemented**.
- `hubspot_tokens` table or addition of `oauth_refresh_token` + `oauth_expires_at` columns to `credentials` table.
- Email draft approval queue table: `(id, user_id, lead_id, draft_content, status, created_at)`.

**Current blockers:** HubSpot OAuth approval pending; OAuth flow not implemented; approval queue not designed.

---

### 4. Finance and KPI Intelligence Agent

**Purpose:** Deterministic anomaly detection on KPI and expenditure data — no probabilistic LLM hallucination.

**Design:**
- Parses the `dashboard_metrics` materialized view in Supabase.
- Uses [Spice.ai](https://spiceai.org/) for zero-ETL SQL federation across hybrid data sources (Supabase, Meta Ads, HubSpot).
- Flags statistical anomalies in conversion velocity and operational expenditures using deterministic SQL aggregations.
- Does **not** use LLMs for numerical analysis — strictly SQL + statistical thresholds.

**Prerequisites:**
- `dashboard_metrics` view created in Supabase (currently the dashboard route aggregates on-the-fly; no materialized view).
- Spice.ai runtime deployed alongside backend (Docker or standalone binary).
- Spice.ai `spicepod.yaml` configured with Supabase, Meta, and HubSpot data sources.
- Anomaly threshold configuration table: `(metric_name, warning_threshold, critical_threshold, user_id)`.

**Current blockers:** `dashboard_metrics` view not created; Spice.ai not integrated; threshold schema not designed.

---

### 5. Orchestration Layer — Event Bus Design

**Purpose:** Centralized event routing to prevent each agent from independently polling external APIs (which rapidly exhausts rate limits).

**Design:**
```
Supabase DB Webhook  →  POST /api/orchestration/events
       ↓
  Event Router (backend/src/routes/orchestration.js — NOT YET CREATED)
       ↓
  ┌─────────────────────────────────────┐
  │  CRM Agent (lead categorization)    │
  │  Marketing Agent (attribution)      │
  │  Finance Agent (KPI snapshot)       │
  └─────────────────────────────────────┘
```

**Trigger example:** Insert into `leads` → Supabase webhook fires → orchestration queue routes to CRM Agent for stage classification and to Marketing Agent for source attribution.

**Prerequisites:**
- Supabase Database Webhooks configured for `INSERT` events on `leads`, `integrations`, and `credentials` tables.
- `POST /api/orchestration/events` endpoint with HMAC verification of Supabase webhook signature.
- Job queue table: `(id, event_type, payload JSONB, agent_target, status, created_at, processed_at)`.
- Worker process (Node.js `setInterval` or BullMQ) that processes the queue.

**Current blockers:** Endpoint not created; Supabase webhooks not configured; queue table not in schema.

---

## External Blockers — Actions Required

| Blocker | Required Action | Blocks |
|---|---|---|
| Meta business verification | Submit business verification docs to Meta Developer Portal; request `ads_read`, `leads_retrieval`, `pages_manage_posts` permissions | Marketing Agent, meta-trends dashboard endpoint |
| HubSpot OAuth approval | Submit app for review in HubSpot Developer Portal; acquire production Client ID + Secret | Sales/CRM Agent, HubSpot sync |
| `pgvector` extension | Enable via Supabase Dashboard → Database → Extensions | Market Intelligence Agent |
| Spice.ai deployment | Deploy Spice.ai runtime; configure `spicepod.yaml` | Finance/KPI Agent |
| Secret management | Implement [Doppler](https://doppler.com/) for credential injection across environments | All agents (production credential security) |

---

## Minimal Structural Additions Required Before Any Agent Goes Live

1. **Add to `001_initial_schema.sql` (or a new migration):**
   - `agent_jobs` table: `(id, type, payload JSONB, status, created_at, processed_at)`
   - `agent_outputs` table: `(id, job_id, agent_type, output JSONB, reviewer_status, created_at)`

2. **Backend additions:**
   - `POST /api/orchestration/events` — receives Supabase webhooks, enqueues jobs
   - `GET /api/agents/jobs` — lists job history for the current user
   - `PATCH /api/agents/jobs/:id/approve` — approves an agent output for execution

3. **Approval gate:** all outbound agent actions (email sends, HubSpot writes, Meta campaign changes) must pass through the `agent_outputs.reviewer_status = 'approved'` check before execution. No autonomous write access to external systems until this gate is validated in production.

