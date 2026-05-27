# Setting Up Supabase Database Webhooks via CLI

This guide explains how to create the two required Database Webhooks using the Supabase CLI + a helper script (instead of clicking in the Dashboard).

## Prerequisites

1. Supabase CLI installed and authenticated (`supabase login`)
2. A Personal Access Token with project admin permissions
3. Your project reference

## Step 1: Apply the capi_sent Migration + Deploy Function

```bash
# Apply database changes
supabase db push

# Deploy the Edge Function (contains the CAPI handler)
supabase functions deploy api --no-verify-jwt
```

## Step 2: Create Both Webhooks Programmatically

O sigue la guía paso a paso exacta que te dieron (recomendada para el Webhook #2):

→ Ver `docs/supabase-webhook-2-setup-steps.md` (incluye los clics exactos en "Add header" + `X-Webhook-Secret` + valor `Doctoralia_Secret_2026_!!`)

```bash
# Set the required variables
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxxxxx"
export SUPABASE_PROJECT_REF="ssvvuuysgxyqvmovrlvk"

# Webhook #2 (Google Sheets) - required
export SHEETS_WEBHOOK_URL="https://script.google.com/macros/s/XXXXXXXXXXXXXXXX/exec"

# Optional but recommended
export SHEETS_WEBHOOK_SECRET="your-super-secret-string-here"

# Run the setup script
node scripts/setup-supabase-webhooks.js
```

The script will create (or detect existing):
- `capi_purchase_on_pagada` → Webhook #1 (CAPI)
- `sync_to_google_sheets` → Webhook #2 (Google Sheets mirror)

## Step 3: Verify

You can check the created webhooks with:

```bash
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/webhooks"
```

Or simply go to the Dashboard → Database → Webhooks to confirm they appear.

## Notes

- The script is idempotent (safe to run multiple times).
- Webhook #1 points to your Edge Function and uses the `capi_sent` guard.
- Webhook #2 points to your Google Apps Script and includes the secret header when provided.

This approach allows full infrastructure-as-code automation for the webhook layer.