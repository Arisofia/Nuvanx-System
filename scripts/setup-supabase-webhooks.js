/**
 * scripts/setup-supabase-webhooks.js
 * Versión Robusta: Sin dependencias externas (usa el módulo 'https' nativo de Node.js)
 *
 * Uso:
 *   export SUPABASE_ACCESS_TOKEN=...
 *   export SUPABASE_PROJECT_REF=...
 *   export SHEETS_WEBHOOK_URL=...
 *   export SHEETS_WEBHOOK_SECRET=...
 *   node scripts/setup-supabase-webhooks.js
 *
 * Para GitHub Actions / CI, define estos secretos en Settings → Secrets.
 *
 * See README for "Doctoralia" sheet + webhook setup (separate SHEETS_WEBHOOK_URL_DOCTORALIA etc for the raw Doctoralia tab with ARRAYFORMULA parsing).
 */
const https = require('https');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.SHEETS_WEBHOOK_SECRET;

async function setupWebhooks() {
  console.log(`🚀 Iniciando configuración de webhooks para el proyecto: ${PROJECT_REF}`);

  // Validación de variables

  const missing = [];
  if (!PROJECT_REF) missing.push('SUPABASE_PROJECT_REF');
  if (!ACCESS_TOKEN) missing.push('SUPABASE_ACCESS_TOKEN');
  if (!WEBHOOK_URL) missing.push('SHEETS_WEBHOOK_URL');
  if (!WEBHOOK_SECRET) missing.push('SHEETS_WEBHOOK_SECRET');

  if (missing.length > 0) {
    console.error('❌ Error: Faltan las siguientes variables de entorno:');
    missing.forEach((v) => console.error(`   - ${v}`));
    console.log('\nDebes exportarlas antes de ejecutar el script. Ejemplo:');
    console.log("  export SUPABASE_ACCESS_TOKEN='sbp_xxx'");
    console.log("  export SUPABASE_PROJECT_REF='tu_ref'");
    console.log("  export SHEETS_WEBHOOK_URL='https://script.google.com/...'");
    console.log("  export SHEETS_WEBHOOK_SECRET='webhook-secret-value'");
    console.log('\nO cárgalas desde tu archivo de secrets y luego ejecuta el script.');
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
        'Content-Type': 'application/json',
      },
    },
  });

  const options = {
    hostname: 'api.supabase.com',
    port: 443,
    path: `/v1/projects/${PROJECT_REF}/database/webhooks`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(webhookData),
    },
  };

  const req = https.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => {
      responseBody += chunk;
    });
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('✅ Webhook #2 (Google Sheets) creado exitosamente en Supabase.');
      } else if (res.statusCode === 409) {
        console.log('⚠️  El webhook ya existe (posiblemente ya fue creado antes).');
      } else if (res.statusCode === 404) {
        console.error(
          '\n❌ ERROR: La API de Supabase no permite crear Database Webhooks vía Management API (404 en /database/webhooks).',
        );
        console.log('\nEsto es una limitación conocida de Supabase.');
        console.log(
          'Debes crear el Webhook #2 manualmente en el Dashboard (es el método oficial y fiable):\n',
        );
        console.log('=== PASOS EXACTOS EN EL DASHBOARD ===\n');
        console.log(
          `1. Ve a: https://supabase.com/dashboard/project/${PROJECT_REF}/database/webhooks`,
        );
        console.log("2. Haz clic en 'Create a new hook'");
        console.log('3. Configura exactamente:');
        console.log('   - Name:           Sync_To_Google_Sheets');
        console.log('   - Table:          produccion_intermediarios');
        console.log('   - Events:         INSERT + UPDATE (marca ambos)');
        console.log(`   - Webhook URL:    ${WEBHOOK_URL}`);
        console.log('   - Method:         POST');
        console.log("4. En 'HTTP Headers' → Add header:");
        console.log('   - Header Name:    X-Webhook-Secret');
        console.log(
          '   - Header Value:   (usa el valor de la variable SHEETS_WEBHOOK_SECRET; no se muestra por seguridad)',
        );
        console.log('5. (Opcional) Conditions: déjalo vacío.');
        console.log("6. Haz clic en 'Create webhook'.\n");
        console.log("Después de crearlo, prueba con el botón 'Send test' desde el Dashboard.");
        console.log('Luego revisa las Ejecuciones en tu Google Apps Script.');
      } else {
        console.error(`❌ Error de Supabase (Status ${res.statusCode}):`, responseBody);
      }
    });
  });

  req.on('error', (error) => {
    console.error('❌ Error de red al conectar con Supabase:', error.message);
  });

  req.write(webhookData);
  req.end();
}

setupWebhooks();
