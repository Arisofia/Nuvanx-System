/**
 * scripts/setup-supabase-webhooks.js
 * Versión Robusta: Sin dependencias externas (usa el módulo 'https' nativo de Node.js)
 */
const https = require('https');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.SHEETS_WEBHOOK_SECRET;

async function setupWebhooks() {
  console.log(`🚀 Iniciando configuración de webhooks para el proyecto: ${PROJECT_REF}`);

  // Validación de variables

  if (!PROJECT_REF || !ACCESS_TOKEN || !WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error("❌ Error: Faltan variables de entorno necesarias.");
    console.log("Asegúrate de haber ejecutado los comandos 'export ...' antes de correr este script.");
    process.exit(1);
  }

  const webhookData = JSON.stringify({
    name: 'Sync_To_Google_Sheets',
    table: 'produccion_intermediarios',
    events: ['INSERT', 'UPDATE'],
    type: 'http_request',
    config: {
      url: WEBHOOK_URL,
      method: 'POST',
      timeout_ms: 5000,
      headers: {
        'X-Webhook-Secret': WEBHOOK_SECRET,
        'Content-Type': 'application/json'
      }
    }
  });

  const options = {
    hostname: 'api.supabase.com',
    port: 443,
    path: `/v1/projects/${PROJECT_REF}/database/webhooks`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(webhookData)
    }
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => { responseBody += chunk; });
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("✅ Webhook #2 (Google Sheets) creado exitosamente en Supabase.");
      } else if (res.statusCode === 409) {
        console.log("⚠️  El webhook ya existe (posiblemente ya fue creado antes).");
      } else {
        console.error(`❌ Error de Supabase (Status ${res.statusCode}):`, responseBody);
      }
    });
  });

  req.on('error', (error) => {
    console.error("❌ Error de red al conectar con Supabase:", error.message);
  });

  req.write(webhookData);
  req.end();
}

setupWebhooks();