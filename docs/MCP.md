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
**Estado:** En desarrollo (Beta)

## URL del Servidor (para Grok)

```
https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/mcp
```

## Cómo configurar en Grok

1. Ve a [grok.com/connectors](https://grok.com/connectors)
2. **New Connector** → **Custom**
3. **Nombre**: `Nuvanx MCP`
4. **URL del Servidor**: pega la URL de arriba
5. Guarda y actívalo

## Tools disponibles (actualizado 2026-05-08)

| Tool                          | Descripción                                      |
|-------------------------------|--------------------------------------------------|
| `get_dashboard_metrics`       | Métricas clave del dashboard                     |
| `get_leads`                   | Leads con filtros (etapa, clínica, fecha)        |
| `get_meta_campaign_insights`  | Insights de campañas Meta                        |
| `search_leads`                | Búsqueda por nombre, teléfono o email            |
| `get_revenue_summary`         | Resumen de revenue verificado vs estimado        |
| `get_doctoralia_settlements`  | Settlements de Doctoralia                        |

## Notas importantes

- Este MCP **no reemplaza** el backend principal (`supabase/functions/api/index.ts`).
- Actualmente usa `service_role` (revisar seguridad antes de producción).
- No modifica RLS ni migraciones.
- Para desarrollo local: `supabase functions serve mcp --no-verify-jwt`

## Autenticación (desde 08-05-2026)

**Tipo**: API Key (header `x-api-key`)

**Cómo usarlo en Grok**:
- Ve a **grok.com/connectors** → edita el conector `Nuvanx MCP`
- En **Advanced / Headers** (si aparece) añade:
  - Header: `x-api-key`
  - Valor: `TU_MCP_API_KEY_AQUI`
- Si Grok no tiene campo de headers, usa el campo **API Key** o **Bearer Token** con el mismo valor.

**Ejemplo de header**:

```
x-api-key: tu_clave_secreta_aqui
```

**Importante**: Nunca compartas esta clave. Si la comprometes, cámbiala con:

```bash
supabase secrets set MCP_API_KEY=nueva_clave
supabase functions deploy mcp --no-verify-jwt
```

## Health Check & Automatización (desde 08-05-2026)

El sistema ahora cuenta con monitoreo y tareas automáticas diarias.

### Health Check (Estado del sistema)

Puedes verificar la salud de los servicios críticos (incluyendo este MCP) ejecutando:

```bash
deno run --allow-net --allow-env scripts/health-check-nuvanx.ts
```

### Automatización Diaria

Se ha implementado una Edge Function (`daily-aggregates`) que se ejecuta automáticamente mediante un Cron Job a las 03:00 UTC. Esta función realiza:
- **Detección de Leads en riesgo**: Identifica leads que llevan más de 14 días en etapa "Nuevo".
- **Rankings de Campañas**: Recalcula los rankings de las mejores campañas por volumen de leads.

### GitHub Actions

Existe un workflow automatizado en `.github/workflows/daily-health-check.yml` que ejecuta el health check completo todos los días a las 04:00 UTC.

## Próximos pasos

- Añadir autenticación (API Key o JWT)
- Añadir más tools útiles
- Testing y documentación completa
