# Nuvanx MCP Server

## Production URL

`https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/mcp`

The MCP transport endpoint is exposed by the `mcp` Supabase Edge Function at `/functions/v1/mcp`. Use this URL when configuring external MCP clients.

## Current tools

| Tool | Purpose |
|---|---|
| `get_dashboard_metrics` | Returns dashboard KPI metrics from production tables, including leads, financial settlements, integrations, and cached Meta insights. |
| `get_leads` | Returns CRM leads with optional filters for clinic, stage, source, creation date, and limit. |
| `get_meta_campaign_insights` | Returns cached Meta Ads daily insights from `meta_daily_insights`. |
| `search_leads` | Searches active leads by name, phone, or email. |

## Connect from Grok

1. Open Grok connectors.
2. Create a new custom connector.
3. Set **Name** to `Nuvanx MCP`.
4. Set **URL** to `https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/mcp`.
5. Use **no OAuth**.
6. If `MCP_API_KEY` is configured, send it as a bearer token: `Authorization: Bearer <MCP_API_KEY>`.

## Security notes

- The MCP function uses `SUPABASE_SERVICE_ROLE_KEY` server-side to query production data. This key must never be exposed to clients or connector configuration.
- Production deployments should configure `MCP_API_KEY` as a Supabase secret so the MCP endpoint requires bearer authentication.
- If `MCP_API_KEY` is not configured, the MCP authorization guard allows requests; do not run production MCP this way.
- Keep tool outputs scoped and minimal. Avoid adding tools that expose raw secrets, credentials, or unnecessary PII.
