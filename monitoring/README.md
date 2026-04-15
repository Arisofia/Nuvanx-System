# Supabase → Grafana Cloud Monitoring

## What's set up

| File | Purpose |
|---|---|
| `alloy/config.alloy` | Grafana Alloy scrape config — polls Supabase Metrics API every 60 s |
| `alloy/docker-compose.yml` | Run Alloy locally or on a VM (requires Docker) |

## Pre-requisites

1. **Docker** installed (for the compose approach)
2. Your **Grafana Cloud stack** details (one-time lookup)

---

## Step 1 — Get your Prometheus remote-write details

1. Go to [grafana.com](https://grafana.com) → **My Account**
2. Under your org, click **Details** next to your stack
3. In the **Prometheus** section, copy:
   - **Remote Write Endpoint** — looks like  
     `https://prometheus-prod-10-prod-eu-west-0.grafana.net/api/prom/push`
   - **Username** — a numeric ID, e.g. `1234567`
4. A password/token: use `GRAFANA_TOKEN` already in your `.env`  
   *(If the token returns 401 on push, create a new token at grafana.com → Profile → Service Accounts with `metrics:write` scope)*

## Step 2 — Fill in `backend/.env`

```
GRAFANA_PROM_URL=https://prometheus-prod-10-prod-eu-west-0.grafana.net/api/prom/push
GRAFANA_PROM_USER=1234567
GRAFANA_TOKEN=<your-grafana-service-account-token>
```

## Step 3 — Start Alloy

```bash
cd monitoring/alloy
docker compose up -d
# Confirm it's scraping:
curl http://localhost:12345/metrics | head -5
```

## Step 4 — Import the Supabase dashboard into Grafana Cloud

1. In your Grafana Cloud stack, go to **Dashboards → Import**
2. Enter dashboard ID **`19663`** (official supabase-grafana dashboard)  
   or download from: https://github.com/supabase/supabase-grafana/blob/main/dashboards/database.json
3. Select your Prometheus data source → **Import**

---

## Supabase Metrics API reference

| Detail | Value |
|---|---|
| URL | `https://ssvvuuysgxyqvmovrlvk.supabase.co/customer/v1/privileged/metrics` |
| Auth | Basic — username: `service_role`, password: `SUPABASE_SERVICE_ROLE_KEY` |
| Format | Prometheus text exposition |
| Confirmed | ✅ HTTP 200 (tested 2026-04-15) |

---

## ⚠️ Security reminder

The `glsa_*` token in `.env` was found in plaintext in  
`/Users/MARIA/Downloads/cedar-league-465204-j0-a477171afb68.json`  
alongside Google Cloud, OpenAI, Anthropic, GitHub, and other credentials.  
**Rotate all tokens in that file** — see the alert raised during this session.
