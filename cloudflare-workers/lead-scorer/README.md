# Lead Scorer — Deploy en 3 pasos

Stack: HubSpot CRM → Cloudflare Workers AI (Llama-4-Scout, **gratis**) → Dashboard

## 1. Obtener token de HubSpot

HubSpot → Settings → Integrations → Private Apps → Crear app
- Scope necesario: `crm.objects.contacts.read` + `crm.objects.contacts.write`
- Copia el token generado

## 2. Obtener token de Cloudflare

https://dash.cloudflare.com/profile/api-tokens → Create Token
- Plantilla: "Edit Cloudflare Workers"
- Copia el token

## 3. Deploy (un comando)

```bash
git clone <este-repo>
cd lead-scorer
npm install

# Configurar tokens
export CLOUDFLARE_API_TOKEN=tu_token_cloudflare
npx wrangler secret put HUBSPOT_TOKEN
# (pega tu token de HubSpot cuando lo pida)

# Deploy
npx wrangler deploy
```

## URLs disponibles tras deploy

| Ruta | Descripción |
|------|-------------|
| `https://lead-scorer.<tu-subdominio>.workers.dev/score` | Dashboard con análisis IA |
| `https://lead-scorer.<tu-subdominio>.workers.dev/api/leads` | JSON para integraciones |

## Coste total

| Componente | Precio |
|------------|--------|
| Cloudflare Workers | Gratis (100k req/día) |
| Workers AI (Llama-4-Scout) | Gratis (10k neurons/día) |
| HubSpot Starter | Ya pagado |
| **Total adicional** | **€0** |
