# Nuvanx MCP Server

## MCP URL

`https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/mcp`

## Current tools

- `get_dashboard_metrics`
- `get_leads`
- `get_meta_campaign_insights`
- `search_leads`

## Grok configuration

1. Open Grok connectors.
2. Create a custom connector.
3. Set **Name** to `Nuvanx MCP`.
4. Set **URL** to `https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/mcp`.
5. Use **no OAuth**.

## Security note

The MCP Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` server-side. `MCP_API_KEY` is optional in the current implementation; when configured, clients should send it as `Authorization: Bearer <MCP_API_KEY>`. Review authentication, tool scope, logging, and data exposure before treating MCP as production-ready.
