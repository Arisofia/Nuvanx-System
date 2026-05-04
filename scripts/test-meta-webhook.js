#!/usr/bin/env node
/**
 * test-meta-webhook.js
 *
 * Sends a signed fake Meta leadgen webhook POST to the Edge Function so you
 * can verify end-to-end that the handler is alive and the HMAC check passes.
 *
 * NOTE: The Graph API fetch that follows (/{leadgen_id}?fields=...) will fail
 * unless you provide a REAL leadgen_id from an actual Meta lead submission.
 * Use Meta's "Test Lead" button in the Lead Ads Testing Tool to generate one:
 *   https://developers.facebook.com/tools/lead-ads-testing
 *
 * What this script confirms:
 *   1) The endpoint is reachable (HTTP 200 "ok").
 *   2) The HMAC-SHA256 signature is accepted (no HTTP 403).
 *   3) The webhook parses the payload and looks up the integration by page_id.
 *
 * REQUIRED ENV:
 *   META_APP_SECRET      — must match the Supabase secret of the same name
 *   META_WEBHOOK_URL     — e.g. https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/webhooks/meta
 *
 * OPTIONAL:
 *   META_PAGE_ID         — Facebook Page ID linked to your integration
 *   META_LEADGEN_ID      — Real leadgen_id (from Test Lead tool) for full E2E
 *   LOAD_LOCAL_DOTENV=1  — load .env from repo root (local dev only)
 *
 * USAGE (dry-run — confirms signature + reachability, Graph API fetch will fail):
 *   META_APP_SECRET=<secret> \
 *   META_WEBHOOK_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/webhooks/meta \
 *   META_PAGE_ID=<your_page_id> \
 *   node scripts/test-meta-webhook.js
 *
 * USAGE (full E2E — inserts a real lead row):
 *   META_APP_SECRET=<secret> \
 *   META_WEBHOOK_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co/functions/v1/api/webhooks/meta \
 *   META_PAGE_ID=<page_id> \
 *   META_LEADGEN_ID=<real_leadgen_id_from_test_tool> \
 *   SUPABASE_URL=https://ssvvuuysgxyqvmovrlvk.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/test-meta-webhook.js
 */

'use strict';

const crypto = require('node:crypto');
const path   = require('node:path');
const fs     = require('node:fs');

const dotenvPath = path.join(__dirname, '..', '.env');
if (process.env.LOAD_LOCAL_DOTENV === '1' && fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const {
  META_APP_SECRET,
  META_WEBHOOK_URL,
  META_PAGE_ID      = '111222333444555',  // placeholder if not provided
  META_LEADGEN_ID   = '987654321012345',  // placeholder — Graph API fetch will fail
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!META_WEBHOOK_URL) {
  console.error('META_WEBHOOK_URL is required.');
  process.exit(1);
}

// ── Exact payload shape that Meta sends ──────────────────────────────────────
// https://developers.facebook.com/docs/marketing-api/webhooks/lead-ads
const now = Math.floor(Date.now() / 1000);
const payload = {
  object: 'page',
  entry: [
    {
      id: META_PAGE_ID,
      time: now,
      changes: [
        {
          field: 'leadgen',
          value: {
            leadgen_id: META_LEADGEN_ID,  // handler fetches full details from this
            page_id:    META_PAGE_ID,
            form_id:    '111000111000111',
            ad_id:      '222000222000222',
            adset_id:   '333000333000333',
            campaign_id:'444000444000444',
            created_time: now,
          },
        },
      ],
    },
  ],
};

const bodyStr = JSON.stringify(payload);

// ── HMAC-SHA256 signature (same algorithm as index.ts handlePublicRoutes) ────
function sign(body, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function main() {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (META_APP_SECRET) {
    headers['X-Hub-Signature-256'] = sign(bodyStr, META_APP_SECRET);
    console.log('Signature header:', headers['X-Hub-Signature-256']);
  } else {
    console.warn(
      '[WARN] META_APP_SECRET not set — sending without signature.\n' +
      '       This only works if the Edge Function runs with IS_DEVELOPMENT=true.',
    );
  }

  console.log('\nPOST', META_WEBHOOK_URL);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const res = await fetch(META_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: bodyStr,
  });

  const text = await res.text();
  console.log(`\nHTTP ${res.status}: ${text}`);

  if (res.status === 403) {
    console.error(
      '\n[FAIL] 403 Forbidden — HMAC mismatch.\n' +
      '       Make sure META_APP_SECRET here matches the Supabase secret exactly.',
    );
    process.exit(1);
  }
  if (res.status !== 200) {
    console.error(`[FAIL] Unexpected status ${res.status}`);
    process.exit(1);
  }

  console.log('\n[OK] Webhook accepted (HTTP 200). HMAC check passed.');

  // ── Optional: verify a lead row was created ──────────────────────────────
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.log(
      '\n[SKIP] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping DB check.\n' +
      '       Set them to confirm a lead row was inserted.',
    );
    return;
  }

  // Give the Edge Function ~3 s to complete the async DB write
  await new Promise((r) => setTimeout(r, 3000));

  const dbRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?external_id=eq.${META_LEADGEN_ID}&select=id,name,source,stage,created_at&limit=1`,
    {
      headers: {
        apikey:        SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Accept:        'application/json',
      },
    },
  );
  const rows = await dbRes.json();

  if (Array.isArray(rows) && rows.length > 0) {
    console.log('\n[LEAD INSERTED]', rows[0]);
  } else {
    console.warn(
      '\n[WARN] No lead row found for external_id=' + META_LEADGEN_ID + '.\n' +
      '       This is expected when META_LEADGEN_ID is a fake placeholder\n' +
      '       because the Graph API fetch will fail and the lead is skipped.\n' +
      '       Use a REAL leadgen_id from https://developers.facebook.com/tools/lead-ads-testing\n' +
      '       to perform a full end-to-end insertion test.',
    );
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message ?? err);
  process.exit(1);
});
