/**
 * scripts/test-capi-contact.js
 * 
 * Manual test script to fire a Contact CAPI event with rich signals
 * and a test_event_code so you can see it live in Meta Events Manager
 * and monitor EMQ in real time.
 *
 * Usage:
 *   node scripts/test-capi-contact.js --phone="+34612345678" --email="test@nuvanx.com" --test_event_code="TEST12345" --fbc="fb.1.123..." --fbp="fb.1.456..."
 *
 * Recommended: Use a real test_event_code from Meta Events Manager (Test Events tab).
 */

import https from 'https';
import crypto from 'crypto';
import { config } from 'dotenv';

config({ path: '.env.local' });

const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
};

const PHONE = getArg('phone') || '+34612345678';
const EMAIL = getArg('email') || 'test@nuvanx.com';
const TEST_EVENT_CODE = getArg('test_event_code') || process.env.META_TEST_EVENT_CODE;
const FBC = getArg('fbc') || null;
const FBP = getArg('fbp') || null;
const EXTERNAL_ID = getArg('external_id') || 'test-lead-123';

if (!TEST_EVENT_CODE) {
  console.error('ERROR: --test_event_code is required (get it from Meta Events Manager → Test Events)');
  process.exit(1);
}

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PIXEL_ID = process.env.META_PIXEL_ID || '1405503384615251';

if (!ACCESS_TOKEN) {
  console.error('ERROR: META_ACCESS_TOKEN not found in .env.local');
  process.exit(1);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

async function sendTestContact() {
  const userData = {
    ph: [sha256Hex(PHONE)],
    em: [sha256Hex(EMAIL)],
  };

  if (FBC) userData.fbc = FBC;
  if (FBP) userData.fbp = FBP;
  if (EXTERNAL_ID) userData.external_id = [sha256Hex(EXTERNAL_ID)];

  // Add a fake but realistic client_user_agent to help EMQ
  userData.client_user_agent = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'];

  const event = {
    event_name: 'Contact',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'system_generated',
    event_id: `test_contact_${Date.now()}`,
    user_data: userData,
    custom_data: {
      source: 'manual_capi_test_script',
      test: true,
    },
  };

  const payload = {
    data: [event],
    test_event_code: TEST_EVENT_CODE,
  };

  const postData = JSON.stringify(payload);

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v20.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('\n=== CAPI Test Contact Response ===');
        console.log('Status:', res.statusCode);
        console.log('Response:', data);
        console.log('\nCheck in Meta Events Manager → Test Events for event_id:', event.event_id);
        console.log('Look at the Contact row and watch the EMQ column update in real time.');
        resolve(data);
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

console.log('Firing test Contact CAPI event...');
console.log('Pixel:', PIXEL_ID);
console.log('Test Event Code:', TEST_EVENT_CODE);
console.log('Phone (hashed):', sha256Hex(PHONE).slice(0, 12) + '...');
console.log('Email (hashed):', sha256Hex(EMAIL).slice(0, 12) + '...');

sendTestContact().catch(console.error);
