# Agents and Integrations Architecture

**Repository:** Arisofia/Nuvanx-System
**Last Updated:** 2026-04-13
**Source:** Verified against actual repo contents

> This document formalizes the current state of AI agents, integrations, and operational workflows in the Nuvanx System, and provides a recommended architecture for future extension. It distinguishes clearly between what is implemented, what is scaffolded, and what does not yet exist.

---

## 1. Current AI Layer (Implemented)

### What exists today

The AI layer lives in `backend/src/routes/ai.js` and two service files:

**`backend/src/services/openai.js`**
- `generateContent(apiKey, prompt, model)` — OpenAI Chat Completions API call
- `analyzeCampaign(apiKey, campaignData)` — Structured campaign analysis with JSON output parsing

**`backend/src/services/gemini.js`**
- `generateContent(apiKey, prompt)` — Google Gemini API equivalent

**API Routes:**
| Endpoint | What it does |
|----------|-------------|
| `POST /api/ai/generate` | Generate marketing content (ad copy, emails, scripts) |
| `POST /api/ai/analyze-campaign` | Analyze campaign data and return optimization suggestions + score |
| `POST /api/ai/suggestions` | AI-powered suggestions based on **real** lead + integration data |

**Credential resolution:** Per-user vault → other provider fallback → server env var (`OPENAI_API_KEY` / `GEMINI_API_KEY`).

**Rate limiting:** AI routes use a separate stricter limiter (`aiLimiter`): 10 req/min.

### What the AI layer can do right now
- Generate arbitrary marketing content via prompts
- Analyze campaign data (JSON input → structured suggestions + score)
- Generate suggestions grounded in real CRM data (lead counts, stages, conversion rates, Meta spend if connected)

### What the AI layer cannot do right now
- It is **not autonomous** — every action requires an explicit API call
- It does not schedule, trigger, or chain actions automatically
- It has no memory or context window across sessions
- It does not read live external data streams (webhooks, real-time events)

---

## 2. Current Integration Points

### Backend integrations (`backend/src/services/`)

| Service | Type | Implementation Status | What Works |
|---------|------|-----------------------|------------|
| **OpenAI** | API Key | ✅ Full | Content generation, campaign analysis |
| **Google Gemini** | API Key | ✅ Full | Content generation (alternative to OpenAI) |
| **Meta Marketing API** | Access Token | ✅ Full | Campaign list, ad metrics, insights, trends |
| **WhatsApp Business** | Cloud API Token | ✅ Full | Send messages, test connection |
| **HubSpot CRM** | Private App Token | ✅ Full | Contact/deal sync, trend data |
| **Google Calendar** | OAuth2 Token | ⚠️ Partial | Token passthrough; no OAuth 2.0 callback flow |
| **Gmail** | OAuth2 Token | ⚠️ Partial | Token passthrough; no OAuth 2.0 callback flow |
| **GitHub** | Personal Access Token | ✅ Full | Token verification, repo access test |

### Frontend integration layer

- `frontend/src/pages/Integrations.jsx` — Connect/test/manage all integrations
- `frontend/src/components/IntegrationCard.jsx` — Per-service connect modal + status
- `frontend/src/hooks/useIntegrations.js` — React hook managing local + Supabase state
- `frontend/src/lib/supabase/integrations.js` — Supabase Postgres Changes for real-time status sync

### Credential resolution priority
```
1. Per-user encrypted vault (credential.js)
2. Server-level environment variable defaults (config/env.js)
```

This means the system can work with either admin-level env var API keys (single-tenant dev use) or per-user credential vaults (multi-tenant production use).

---

## 3. What "Agents" Currently Mean in This Repo

The term "agent" does not have a formal definition in the current codebase. The existing system is better described as:

> **A credential-gated AI proxy** — the backend securely stores user credentials, proxies requests to AI APIs, and uses real CRM data to contextualize AI responses.

The `/api/ai/suggestions` endpoint is the closest thing to an "agent behavior" — it:
1. Fetches real lead data from the DB
2. Fetches real Meta metrics if connected
3. Constructs a grounded prompt
4. Calls OpenAI/Gemini
5. Returns structured suggestions

But it is **stateless**, **single-shot**, and **user-triggered** — not an autonomous agent.

---

## 4. Scaffolded vs. Missing

| Concept | Status | Where |
|---------|--------|-------|
| AI content generation | ✅ Working | `routes/ai.js` + `services/openai.js`, `services/gemini.js` |
| Data-grounded AI suggestions | ✅ Working | `routes/ai.js` `/suggestions` endpoint |
| Integration connect/test | ✅ Working | `routes/integrations.js` + all service files |
| Campaign analysis | ✅ Working | `ai.js` `/analyze-campaign` |
| Playbooks (UI only) | ⚠️ Scaffolded | `pages/Playbooks.jsx` — static content, no backend execution |
| Playbook execution engine | ❌ Missing | No route, no model, no scheduler |
| Agent loop / autonomy | ❌ Missing | No trigger/event/schedule system |
| Webhook receiver (Meta/WhatsApp) | ❌ Missing | No `/api/webhooks` routes |
| Email automation | ❌ Missing | Gmail service exists but no send flow |
| Scheduled tasks (cron) | ❌ Missing | No cron, no queue, no worker |
| Agent memory / context | ❌ Missing | All AI calls are stateless |

---

## 5. Recommended Future Architecture

The following agents align with the product vision for an aesthetic clinic revenue intelligence platform. These are **architectural recommendations** — none of this code exists yet.

### Agent Taxonomy

```
Nuvanx Agent System
├── Reactive Agents     (event-triggered, near-real-time)
│   ├── Lead Capture Agent
│   └── Reactivation Alert Agent
├── Scheduled Agents    (cron-triggered)
│   ├── Campaign Monitoring Agent
│   └── Reporting Agent
└── On-Demand Agents    (user-triggered, already partially exists)
    ├── Content Generation Agent  ← exists (POST /api/ai/generate)
    └── Campaign Analysis Agent   ← exists (POST /api/ai/analyze-campaign)
```

---

### Growth Agent
**Status:** ❌ Not implemented
**Trigger:** Scheduled (daily) + webhook (Meta lead form)
**Purpose:** Monitor Meta Ads performance, detect underperforming campaigns, suggest budget reallocations.

**Required infrastructure:**
- Meta Ads webhook endpoint (`POST /api/webhooks/meta`)
- Cron scheduler (node-cron or external)
- Agent model/service file: `backend/src/agents/growthAgent.js`
- Writes recommendations to a `recommendations` DB table

**Data sources:** Meta Ads insights, Lead conversion rates, HubSpot pipeline

---

### Content Agent
**Status:** ⚠️ Partially exists (on-demand only)
**Trigger:** User-triggered or scheduled
**Purpose:** Generate campaign copy, email sequences, WhatsApp messages using brand context.

**Current state:** `POST /api/ai/generate` works. Missing: brand profile context, campaign history, template library.

**Recommended additions:**
- `backend/src/agents/contentAgent.js` — wraps current AI service with brand profile context injection
- Brand profile stored per-user in DB (clinic name, tone, specialty, target demographic)
- Template library: saved prompts/outputs per content type

---

### Campaign Monitoring Agent
**Status:** ❌ Not implemented
**Trigger:** Scheduled (every 6h or on-demand)
**Purpose:** Pull Meta Ads metrics, compare against targets, alert on anomalies (CPL spike, low CTR, budget exhaustion).

**Required infrastructure:**
- Cron job or external scheduler
- Alert storage + delivery (email or WhatsApp via existing service)
- `backend/src/agents/campaignMonitorAgent.js`

---

### CRM / Reactivation Agent
**Status:** ❌ Not implemented
**Trigger:** Scheduled (daily)
**Purpose:** Identify leads inactive for 60+ days, generate personalized re-engagement message via WhatsApp/email, update CRM stage.

**Required infrastructure:**
- WhatsApp send endpoint (`POST /api/integrations/whatsapp/send` exists in service, not exposed as route)
- Gmail send capability (service exists but no send route)
- CRM query: `SELECT * FROM leads WHERE stage != 'closed' AND updated_at < NOW() - INTERVAL '60 days'`
- `backend/src/agents/reactivationAgent.js`

---

### Reporting Agent
**Status:** ❌ Not implemented
**Trigger:** Scheduled (weekly, monthly)
**Purpose:** Generate executive summary report combining all data sources (CRM, Meta, AI suggestions), deliver via email.

**Required infrastructure:**
- Report template engine (or Markdown → PDF)
- Email delivery (Gmail or SendGrid)
- `backend/src/agents/reportingAgent.js`

---

## 6. Recommended Code Organization

When implementing agents, use this directory structure:

```
backend/src/
├── agents/                     # Agent implementations (NEW)
│   ├── base.js                 # Abstract agent class (trigger, run, log)
│   ├── contentAgent.js         # On-demand content generation
│   ├── campaignMonitorAgent.js # Scheduled Meta monitoring
│   ├── growthAgent.js          # Scheduled growth recommendations
│   ├── reactivationAgent.js    # Scheduled CRM reactivation
│   └── reportingAgent.js       # Scheduled reporting
├── jobs/                       # Scheduler definitions (NEW)
│   └── scheduler.js            # node-cron or similar
├── services/                   # External API clients (existing)
└── routes/                     # HTTP endpoints (existing)
```

Agent base contract:
```js
// agents/base.js
class BaseAgent {
  constructor(name, userId) { this.name = name; this.userId = userId; }
  async run(context) { throw new Error('Not implemented'); }
  async log(action, result) { /* write to agent_runs table */ }
}
```

---

## 7. Integration Expansion Roadmap

| Phase | Integration | What It Enables |
|-------|-------------|-----------------|
| P1 | Meta Webhooks | Real-time lead arrival → instant CRM entry |
| P1 | WhatsApp Webhooks | Incoming messages → CRM update |
| P2 | Google OAuth 2.0 | Full Calendar booking + Gmail send |
| P2 | OpenAI Assistants API | Persistent conversation context |
| P3 | Twilio | SMS fallback for WhatsApp failures |
| P3 | Zapier/Make webhooks | Low-code automation triggers |

---

## 8. Architecture Diagram (Target State)

```
External Events                     Nuvanx Backend
──────────────                      ──────────────
Meta Lead Form ──────webhook──────► /api/webhooks/meta
WhatsApp Msg  ──────webhook──────► /api/webhooks/whatsapp
                                         │
                                    [Event Router]
                                         │
                              ┌──────────┴──────────┐
                              ▼                      ▼
                        [Lead Agent]          [Content Agent]
                        (create CRM)          (draft WA reply)
                              │                      │
                              ▼                      ▼
                         [CRM Model]         [WhatsApp Service]
                         (DB persist)        (send message)
                              │
                         [Reporting Agent] ← cron: weekly
                              │
                         [Email Service] → (executive summary)

User Actions (existing)
─────────────────────────
Browser → Frontend → Backend REST API → AI/Integration Services
```

---

## 9. Next Steps for Agent Implementation

1. **Expose WhatsApp send as an API route** — `POST /api/integrations/whatsapp/send` (service exists, route does not)
2. **Add webhook receiver routes** — `POST /api/webhooks/meta`, `POST /api/webhooks/whatsapp`
3. **Add `agents/` directory** with a base class and the ContentAgent (lowest-risk, partially exists)
4. **Add a `jobs/` scheduler** using `node-cron` or a queue (BullMQ + Redis)
5. **Add `agent_runs` table** to the DB migration for audit logging
6. **Integrate brand profile** into AI prompts for personalized content
