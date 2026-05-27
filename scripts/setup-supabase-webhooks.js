#!/usr/bin/env node
/**
 * scripts/setup-supabase-webhooks.js
 * Automatiza la creación de webhooks en Supabase para sincronizar con Google Sheets
 *
 * Uso recomendado:
 *   node -r dotenv/config scripts/setup-supabase-webhooks.js --env-file=.env.webhooks
 *
 * O con exports manuales:
 *   SUPABASE_ACCESS_TOKEN=... SHEETS_WEBHOOK_URL=... node scripts/setup-supabase-webhooks.js
 */

require('dotenv').config({ path: '.env.webhooks' });

const fetch = require('node-fetch');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.SHEETS_WEBHOOK_SECRET;

async function setupWebhooks() {
  console.log(`🚀 Iniciando configuración de webhooks para el proyecto: ${PROJECT_REF}`);

  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error("❌ Error: Faltan variables de entorno SHEETS_WEBHOOK_URL o SHEETS_WEBHOOK_SECRET");
    process.exit(1);
  }

  const webhookConfig = {
    name: 'Sync_To_Google_Sheets',
    table: 'produccion_intermediarios',
    events: ['INSERT', 'UPDATE'],
    type: 'http_request',
    config: {
      url: WEBHOOK_URL,
      method: 'POST',
      timeout_ms: 5000,
      headers: {
        // Exact header requested by the user for Supabase Webhook configuration
        'X-Webhook-Secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      }
    }
  };

  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/webhooks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(webhookConfig)
    });

    if (response.ok) {
      console.log("✅ Webhook #2 (Google Sheets) creado exitosamente.");
    } else {
      const error = await response.json();
      console.error("❌ Error al crear el webhook:", error.message || error);
    }
  } catch (err) {
    console.error("❌ Error de red:", err);
  }
}

setupWebhooks();