#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * CLI script to connect (or update) an integration credential via the Nuvanx API.
 *
 * Usage:
 *   node scripts/connect-integration.js \
 *     --service=meta \
 *     --token=<META_ACCESS_TOKEN> \
 *     --ad-account-id=<AD_ACCOUNT_ID> \
 *     [--ad-account-ids=<AD_ACCOUNT_ID_1,AD_ACCOUNT_ID_2>] \
 *     [--page-id=<PAGE_ID>]
 *
 *   node scripts/connect-integration.js --service=openai --token=<OPENAI_KEY>
 *   node scripts/connect-integration.js --service=gemini --token=<GEMINI_KEY>
 *   node scripts/connect-integration.js --service=github --token=<GITHUB_TOKEN>
 *   node scripts/connect-integration.js \
 *     --service=whatsapp --token=<SYSTEM_USER_TOKEN> \
 *     --phone-number-id=<PHONE_NUMBER_ID>
 *
 * Required environment variables (set in .env or pass as CLI flags):
 *   SUPABASE_EMAIL     — Supabase account email
 *   SUPABASE_PASSWORD  — Supabase account password
 *   VITE_SUPABASE_URL  — e.g. https://ssvvuuysgxyqvmovrlvk.supabase.co
 *   VITE_SUPABASE_ANON_KEY — Supabase anon key
 *   API_BASE_URL       — defaults to https://frontend-arisofias-projects-c2217452.vercel.app
 *
 * All values can also be provided as CLI flags:
 *   --email=... --password=... --api-url=...
 */

'use strict';

const path = require('node:path');
const https = require('node:https');

// Load .env files
function tryRequireDotenv() {
  try {
    require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
    require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
  } catch {
    // dotenv not installed — continue with process.env only
  }
}
tryRequireDotenv();

// ── Parse CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      out[raw.slice(2)] = argv[i + 1] ?? '';
      i++;
    } else {
      out[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const service           = (args.service ?? '').trim();
const integToken        = (args.token ?? process.env.META_ACCESS_TOKEN ?? '').trim();
const adAccountId       = (args['ad-account-id'] ?? process.env.META_AD_ACCOUNT_ID ?? '').trim();
const adAccountIds      = (args['ad-account-ids'] ?? process.env.META_AD_ACCOUNT_IDS ?? '').trim();
const pageId            = (args['page-id'] ?? process.env.META_PAGE_ID ?? '').trim();
const phoneNumberId     = (args['phone-number-id'] ?? '').trim();

const email         = (args.email ?? process.env.SUPABASE_EMAIL ?? '').trim();
const password      = (args.password ?? process.env.SUPABASE_PASSWORD ?? '').trim();
const supabaseUrl   = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '').trim();
const supabaseAnon  = (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const apiBase       = (args['api-url'] ?? process.env.API_BASE_URL ?? 'https://frontend-arisofias-projects-c2217452.vercel.app').replace(/\/$/, '').trim();

// ── Validate ──────────────────────────────────────────────────────────────────
const SUPPORTED_SERVICES = ['meta', 'whatsapp', 'openai', 'gemini', 'github', 'google_ads'];

if (!service) {
  console.error('ERROR: --service is required. Supported:', SUPPORTED_SERVICES.join(', '));
  process.exit(1);
}
if (!SUPPORTED_SERVICES.includes(service)) {
  console.error(`ERROR: Unknown service "${service}". Supported:`, SUPPORTED_SERVICES.join(', '));
  process.exit(1);
}
if (!integToken) {
  console.error('ERROR: --token is required (API key / access token for the service).');
  process.exit(1);
}
if (service === 'meta' && !adAccountId && !adAccountIds) {
  console.error('ERROR: --ad-account-id or --ad-account-ids is required for Meta.');
  process.exit(1);
}
if (service === 'whatsapp' && !phoneNumberId) {
  console.error('ERROR: --phone-number-id is required for WhatsApp.');
  process.exit(1);
}
if (!email || !password) {
  console.error('ERROR: Supabase credentials required. Set SUPABASE_EMAIL + SUPABASE_PASSWORD in .env or pass --email=... --password=...');
  process.exit(1);
}
if (!supabaseUrl || !supabaseAnon) {
  console.error('ERROR: Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data   = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode, data: text });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // 1. Authenticate with Supabase to get a JWT
  console.log(`\n[1/3] Authenticating as ${email}…`);
  const authRes = await post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    { email, password },
    {
      apikey:  supabaseAnon,
      Authorization: `Bearer ${supabaseAnon}`,
    },
  );

  if (authRes.status !== 200 || !authRes.data?.access_token) {
    console.error('ERROR: Authentication failed:', authRes.data?.error_description ?? authRes.data?.message ?? authRes.data);
    process.exit(1);
  }
  const jwt = authRes.data.access_token;
  console.log('      ✓ Authenticated');

  // 2. Build metadata payload
  const metadata = {};
  if (service === 'meta') {
    const allAccountIds = String(adAccountIds || adAccountId)
      .split(/[,;\s]+/)
      .map((id) => id.trim())
      .filter(Boolean);
    const normalizedMetaIds = Array.from(new Set(allAccountIds.map((id) => {
      const cleaned = id.toLowerCase().startsWith('act_') ? id.slice(4) : id;
      const digits = String(cleaned).replace(/\D/g, '');
      return digits ? `act_${digits}` : '';
    }).filter(Boolean)));

    if (normalizedMetaIds.length === 0) {
      console.error('ERROR: --ad-account-id or --ad-account-ids must contain at least one valid Meta Ad Account ID.');
      process.exit(1);
    }

    metadata.adAccountIds = normalizedMetaIds;
    metadata.ad_account_ids = normalizedMetaIds;
    metadata.adAccountId = normalizedMetaIds.join(',');
    metadata.ad_account_id = normalizedMetaIds.join(',');
    if (pageId) { metadata.pageId = pageId; metadata.page_id = pageId; }
  }
  if (service === 'whatsapp') {
    metadata.phoneNumberId = phoneNumberId;
    metadata.phone_number_id = phoneNumberId;
  }

  // 3. Call /api/integrations/connect
  console.log(`\n[2/3] Connecting ${service} integration via ${apiBase}/api/integrations/connect…`);
  const connectRes = await post(
    `${apiBase}/api/integrations/connect`,
    { service, token: integToken, metadata },
    {
      Authorization: `Bearer ${jwt}`,
      apikey: supabaseAnon,
    },
  );

  if (connectRes.status !== 200 || connectRes.data?.success === false) {
    console.error('ERROR: Connect failed:', JSON.stringify(connectRes.data, null, 2));
    process.exit(1);
  }
  console.log('      ✓ Integration saved:', JSON.stringify(connectRes.data));

  // 4. Test connection
  console.log(`\n[3/3] Testing ${service} connection…`);
  const testPayload = { service };
  if (service === 'meta' && adAccountId && !adAccountIds) {
    testPayload.adAccountId = adAccountId;
  }
  const testRes = await post(
    `${apiBase}/api/integrations/test`,
    testPayload,
    {
      Authorization: `Bearer ${jwt}`,
      apikey: supabaseAnon,
    },
  );

  if (testRes.data?.success === false) {
    console.warn('WARN: Test returned error:', testRes.data?.message);
  } else {
    console.log('      ✓ Test result:', testRes.data?.message ?? JSON.stringify(testRes.data));
  }

  console.log('\nDone! The integration is now active in Supabase.\n');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message ?? err);
  process.exit(1);
});
