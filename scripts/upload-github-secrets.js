'use strict';
/**
 * Uploads deployment + integration secrets from backend/.env to GitHub Actions Secrets.
 * Uses GitHub REST API + libsodium sealed-box encryption.
 *
 * Run:
 *   node scripts/upload-github-secrets.js
 *
 * Requires:
 *   - GITHUB_PAT in backend/.env with repo secrets write permission
 */

const path = require('path');
const backendDir = path.join(__dirname, '..', 'backend');
// Resolve modules from backend where dotenv and libsodium are installed
const dotenv = require(path.join(backendDir, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(backendDir, '.env') });
const https = require('https');
const sodium = require(path.join(backendDir, 'node_modules', 'libsodium-wrappers'));

const OWNER = 'Arisofia';
const REPO = 'Nuvanx-System';
const PAT = process.env.GITHUB_PAT;

if (!PAT) {
  console.error('ERROR: GITHUB_PAT not set in backend/.env');
  process.exit(1);
}

// Map of GitHub Secret name → env var name (only set ones with real values)
const SECRETS_MAP = {
  JWT_SECRET:               'JWT_SECRET',
  ENCRYPTION_KEY:           'ENCRYPTION_KEY',
  DATABASE_URL:             'DATABASE_URL',
  SUPABASE_URL:             'SUPABASE_URL',
  SUPABASE_ANON_KEY:        'SUPABASE_ANON_KEY',
  SUPABASE_SERVICE_ROLE_KEY:'SUPABASE_SERVICE_ROLE_KEY',
  SUPABASE_JWT_SECRET:      'SUPABASE_JWT_SECRET',
  SUPABASE_FIGMA_URL:       'SUPABASE_FIGMA_URL',
  SUPABASE_FIGMA_ANON_KEY:  'SUPABASE_FIGMA_ANON_KEY',
  SUPABASE_FIGMA_SERVICE_ROLE: 'SUPABASE_FIGMA_SERVICE_ROLE',
  META_VERIFY_TOKEN:        'META_VERIFY_TOKEN',
  GH_PAT:                   'GITHUB_PAT',
  WEBHOOK_ADMIN_USER_ID:    'WEBHOOK_ADMIN_USER_ID',
  CLINIC_ID:                'CLINIC_ID',
  DOCTORALIA_SHEET_ID:      'DOCTORALIA_SHEET_ID',
  GOOGLE_SERVICE_ACCOUNT_JSON: 'GOOGLE_SERVICE_ACCOUNT_JSON',
  RENDER_DEPLOY_HOOK_URL:   'RENDER_DEPLOY_HOOK_URL',
  VERCEL_TOKEN:             'VERCEL_TOKEN',
  VERCEL_ORG_ID:            'VERCEL_ORG_ID',
  VERCEL_PROJECT_ID:        'VERCEL_PROJECT_ID',
  OPENAI_API_KEY:           'OPENAI_API_KEY',
  GEMINI_API_KEY:           'GEMINI_API_KEY',
  ANTHROPIC_API_KEY:        'ANTHROPIC_API_KEY',
  GOOGLE_API_KEY:           'GOOGLE_API_KEY',
  FIGMA_TOKEN:              'FIGMA_TOKEN',
  WHATSAPP_ACCESS_TOKEN:    'WHATSAPP_ACCESS_TOKEN',
  WHATSAPP_PHONE_NUMBER_ID: 'WHATSAPP_PHONE_NUMBER_ID',
  META_ACCESS_TOKEN:        'META_ACCESS_TOKEN',
  META_AD_ACCOUNT_ID:       'META_AD_ACCOUNT_ID',
  META_APP_SECRET:          'META_APP_SECRET',
  META_BUSINESS_ID:         'META_BUSINESS_ID',
  META_PAGE_ID:             'META_PAGE_ID',
};

// Static values not from .env
const STATIC_SECRETS = {
  VERCEL_ORG_ID:     'team_R0GOR4jvw1c1gnyBRWYu32O7',
  VERCEL_PROJECT_ID: 'prj_IAOBlV17HeS22KuEfsdkDrGMV9Ze',
};

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${PAT}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'nuvanx-secret-uploader',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: body ? JSON.parse(body) : {} }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function encryptSecret(publicKeyB64, secretValue) {
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
}

async function main() {
  console.log(`\nUploading GitHub Secrets → ${OWNER}/${REPO}\n`);

  // Get repo public key
  const keyRes = await apiRequest('GET', `/repos/${OWNER}/${REPO}/actions/secrets/public-key`);
  if (keyRes.status !== 200) {
    console.error('Failed to get repo public key:', keyRes.status, JSON.stringify(keyRes.body));
    console.error('Check that GITHUB_PAT has "repo" scope with secrets write permission.');
    process.exit(1);
  }
  const { key, key_id } = keyRes.body;
  console.log(`Got repo public key (key_id: ${key_id})\n`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const [secretName, envKey] of Object.entries(SECRETS_MAP)) {
    const value = STATIC_SECRETS[secretName] || process.env[envKey];
    if (!value) {
      console.log(`  SKIP  ${secretName} — no value`);
      skipped++;
      continue;
    }

    const encryptedValue = await encryptSecret(key, value);
    const res = await apiRequest(
      'PUT',
      `/repos/${OWNER}/${REPO}/actions/secrets/${secretName}`,
      { encrypted_value: encryptedValue, key_id }
    );

    if (res.status === 201 || res.status === 204) {
      console.log(`  ✓  ${secretName}`);
      ok++;
    } else {
      console.error(`  ✗  ${secretName} — HTTP ${res.status}:`, JSON.stringify(res.body));
      failed++;
    }
  }

  console.log(`\nDone: ${ok} uploaded, ${skipped} skipped (no value), ${failed} failed.\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
