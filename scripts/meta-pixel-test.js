#!/usr/bin/env node
/**
 * meta-pixel-test.js
 *
 * Sends a Meta Conversions API (CAPI) test event directly to Graph API so you
 * can verify in Events Manager → Test Events whether your pixel is wired up
 * and credentials work, without touching production data.
 *
 * REQUIRED ENV:
 *   META_ACCESS_TOKEN      — System User token with ads_management permission
 *   META_PIXEL_ID          — Pixel / dataset ID (defaults to project pixel)
 *   META_TEST_EVENT_CODE   — Test code from Events Manager → Test Events
 *
 * OPTIONAL:
 *   META_APP_SECRET        — adds appsecret_proof to the request
 *   EVENT_NAME             — defaults to 'Lead'
 *   TEST_PHONE             — sample phone (E.164); defaults to +34600000000
 *   TEST_EMAIL             — sample email; defaults to test@nuvanx.local
 *
 * USAGE:
 *   META_ACCESS_TOKEN=... \
 *   META_PIXEL_ID=877262375461917 \
 *   META_TEST_EVENT_CODE=TEST12345 \
 *   node scripts/meta-pixel-test.js
 *
 * Then open Events Manager → your pixel → Test Events tab to confirm the
 * event arrives in real time. The event_id used here (`pixel-test-<timestamp>`)
 * is unique per run so you can match it in the dashboard.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('node:crypto');

const {
  META_ACCESS_TOKEN,
  META_PIXEL_ID,
  META_TEST_EVENT_CODE,
  META_APP_SECRET,
  EVENT_NAME = 'Lead',
  TEST_PHONE = '+34600000000',
  TEST_EMAIL = 'test@nuvanx.local',
} = process.env;

if (!META_ACCESS_TOKEN) {
  console.error('ERROR: META_ACCESS_TOKEN is required.');
  process.exit(1);
}
if (!META_PIXEL_ID) {
  console.error('ERROR: META_PIXEL_ID is required.');
  process.exit(1);
}
if (!META_TEST_EVENT_CODE) {
  console.error('ERROR: META_TEST_EVENT_CODE is required (read it from Events Manager → Test Events).');
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return digits;
}

async function main() {
  const eventId = `pixel-test-${Date.now()}`;
  const userData = {
    ph: [sha256(normalizePhone(TEST_PHONE))],
    em: [sha256(TEST_EMAIL)],
  };

  const event = {
    event_name: EVENT_NAME,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'system_generated',
    event_id: eventId,
    user_data: userData,
    custom_data: {
      source: 'nuvanx_pixel_test_script',
    },
  };

  const payload = {
    data: [event],
    test_event_code: META_TEST_EVENT_CODE,
  };

  const url = new URL(`https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events`);
  url.searchParams.set('access_token', META_ACCESS_TOKEN);
  if (META_APP_SECRET) {
    const proof = crypto.createHmac('sha256', META_APP_SECRET).update(META_ACCESS_TOKEN).digest('hex');
    url.searchParams.set('appsecret_proof', proof);
  }

  console.log(`→ POST ${url.origin}${url.pathname}`);
  console.log(`  event_name      = ${EVENT_NAME}`);
  console.log(`  event_id        = ${eventId}`);
  console.log(`  test_event_code = ${META_TEST_EVENT_CODE}`);
  console.log(`  pixel_id        = ${META_PIXEL_ID}`);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  console.log(`\n← ${res.status} ${res.statusText}`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body);
  }

  if (!res.ok) {
    process.exitCode = 1;
    return;
  }
  console.log('\n✓ Event accepted. Open Events Manager → Test Events to confirm it appears.');
  console.log(`  Match by event_id: ${eventId}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
