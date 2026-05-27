# Gestión de Secretos con CLI (Local + GitHub + Supabase)

## 1. Local (.env.webhooks)

El archivo `.env.webhooks` ya fue creado con el secret:

```bash
SHEETS_WEBHOOK_SECRET=Doctoralia_Secret_2026_!!
```

**Nunca subas este archivo a Git.**

## 2. GitHub (usando gh CLI)

Comando ejecutado:

```bash
echo "Doctoralia_Secret_2026_!!" | gh secret set SHEETS_WEBHOOK_SECRET --repo Arisofia/Nuvanx-System
```

También se recomienda agregar:

- `SHEETS_WEBHOOK_URL`
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

## 3. Supabase (usando Supabase CLI)

Después de linkear el proyecto o tener el token:

```bash
# Opción recomendada
supabase secrets set SHEETS_WEBHOOK_SECRET="Doctoralia_Secret_2026_!!" --project-ref ssvvuuysgxyqvmovrlvk

# O usando el access token explícitamente
SUPABASE_ACCESS_TOKEN=tu_token_aqui supabase secrets set SHEETS_WEBHOOK_SECRET="Doctoralia_Secret_2026_!!" --project-ref ssvvuuysgxyqvmovrlvk
```

Alternativa vía Management API (útil cuando no está linkeado):

```bash
curl -X POST "https://api.supabase.com/v1/projects/ssvvuuysgxyqvmovrlvk/secrets" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name": "SHEETS_WEBHOOK_SECRET", "value": "Doctoralia_Secret_2026_!!"}]'
```

## Flujo completo recomendado

```bash
# 1. Local
cp .env.webhooks.example .env.webhooks
# Edita .env.webhooks con tus valores reales

# 2. GitHub
gh secret set SHEETS_WEBHOOK_SECRET --repo Arisofia/Nuvanx-System < .env.webhooks   # (o export manual)

# 3. Supabase
supabase secrets set SHEETS_WEBHOOK_SECRET="Doctoralia_Secret_2026_!!" --project-ref ssvvuuysgxyqvmovrlvk
```

