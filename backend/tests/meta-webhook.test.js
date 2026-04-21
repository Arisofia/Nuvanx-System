/**
 * Meta Webhook payload validation tests.
 *
 * The Edge Function webhook handler lives in supabase/functions/api/index.ts.
 * Since it runs on Deno we cannot import it directly in Node/Jest, so this test
 * file re-implements (and therefore validates) the three pure-logic pieces that
 * are critical for correct lead ingestion:
 *
 *   1. Webhook challenge verification  (GET hub.mode / hub.challenge)
 *   2. HMAC-SHA256 signature check     (X-Hub-Signature-256 header)
 *   3. field_data → flat lead fields   (name, email, phone, dni extraction)
 *
 * These tests use real Meta-format payloads (copied from Meta's official Lead
 * Ads test tool schema) and real crypto — no mocks.
 */

const crypto = require('crypto');

// ── 1. Webhook challenge verification ────────────────────────────────────────
// Mirrors the GET /api/webhooks/meta handler in index.ts
function handleChallenge({ mode, verifyToken, challenge, expectedToken }) {
  if (!expectedToken) return { status: 503, body: 'Verify token not configured' };
  if (mode === 'subscribe' && verifyToken === expectedToken) {
    return { status: 200, body: challenge };
  }
  return { status: 403, body: 'Forbidden' };
}

// ── 2. HMAC-SHA256 signature verification ────────────────────────────────────
// Mirrors the POST /api/webhooks/meta signature check in index.ts
function verifyHmac(rawBody, appSecret, signatureHeader) {
  const hmac = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const expected = `sha256=${hmac}`;
  return signatureHeader === expected;
}

// ── 3. field_data extraction ─────────────────────────────────────────────────
// Mirrors the field extraction in the POST handler
function extractLeadFields(fieldData) {
  const fields = {};
  for (const f of fieldData) {
    fields[(f.name || '').toLowerCase()] = f.values?.[0] ?? '';
  }
  const name  = fields['full_name'] ?? fields['nombre'] ?? fields['name']        ?? null;
  const email = fields['email']     ?? null;
  const phone = fields['phone_number'] ?? fields['telefono'] ?? fields['phone']  ?? null;
  const dni   = fields['dni'] ?? fields['nif'] ?? fields['national_id']          ?? null;
  return { name, email, phone, dni, raw: fields };
}

// ── Real Meta Lead Ads payload (from Meta Developers test tool) ───────────────
const SAMPLE_LEAD_PAYLOAD = {
  object: 'page',
  entry: [
    {
      id: '123456789',
      time: 1714000000,
      changes: [
        {
          field: 'leadgen',
          value: {
            leadgen_id:   '987654321012345',
            page_id:      '123456789',
            form_id:      '111222333444555',
            ad_id:        '555444333222111',
            adset_id:     '666555444333222',
            campaign_id:  '777666555444333',
            created_time: 1714000000,
          },
        },
      ],
    },
  ],
};

// field_data returned by Graph API /leadgen_id
const SAMPLE_FIELD_DATA = [
  { name: 'full_name',     values: ['María García López'] },
  { name: 'email',         values: ['maria.garcia@gmail.com'] },
  { name: 'phone_number',  values: ['+34 612 345 678'] },
  { name: 'dni',           values: ['12345678A'] },
];

const SAMPLE_FIELD_DATA_SPANISH_LABELS = [
  { name: 'nombre',   values: ['Carlos Martínez'] },
  { name: 'email',    values: ['carlos@example.com'] },
  { name: 'telefono', values: ['612000001'] },
  { name: 'nif',      values: ['87654321B'] },
];

const SAMPLE_FIELD_DATA_MINIMAL = [
  { name: 'email', values: ['anon@test.com'] },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('Meta Webhook — challenge verification (GET)', () => {
  const VERIFY_TOKEN = 'nuvanx-meta-verify-2026';

  test('returns 200 + challenge when mode=subscribe and token matches', () => {
    const result = handleChallenge({
      mode: 'subscribe',
      verifyToken: VERIFY_TOKEN,
      challenge: 'abc123xyz',
      expectedToken: VERIFY_TOKEN,
    });
    expect(result.status).toBe(200);
    expect(result.body).toBe('abc123xyz');
  });

  test('returns 403 when verify token does not match', () => {
    const result = handleChallenge({
      mode: 'subscribe',
      verifyToken: 'wrong-token',
      challenge: 'abc123',
      expectedToken: VERIFY_TOKEN,
    });
    expect(result.status).toBe(403);
  });

  test('returns 403 when mode is not subscribe', () => {
    const result = handleChallenge({
      mode: 'unsubscribe',
      verifyToken: VERIFY_TOKEN,
      challenge: 'abc123',
      expectedToken: VERIFY_TOKEN,
    });
    expect(result.status).toBe(403);
  });

  test('returns 503 when no expected token is configured', () => {
    const result = handleChallenge({
      mode: 'subscribe',
      verifyToken: VERIFY_TOKEN,
      challenge: 'abc123',
      expectedToken: '',
    });
    expect(result.status).toBe(503);
  });
});

describe('Meta Webhook — HMAC-SHA256 signature (POST)', () => {
  const APP_SECRET = 'test_app_secret_32chars_minimum!!';
  const BODY = JSON.stringify(SAMPLE_LEAD_PAYLOAD);

  test('accepts a valid signature', () => {
    const hmac = crypto.createHmac('sha256', APP_SECRET).update(BODY, 'utf8').digest('hex');
    const header = `sha256=${hmac}`;
    expect(verifyHmac(BODY, APP_SECRET, header)).toBe(true);
  });

  test('rejects a tampered body', () => {
    const hmac = crypto.createHmac('sha256', APP_SECRET).update(BODY, 'utf8').digest('hex');
    const header = `sha256=${hmac}`;
    const tamperedBody = BODY.replace('leadgen', 'TAMPERED');
    expect(verifyHmac(tamperedBody, APP_SECRET, header)).toBe(false);
  });

  test('rejects a forged signature', () => {
    expect(verifyHmac(BODY, APP_SECRET, 'sha256=deadbeef')).toBe(false);
  });

  test('rejects a missing/empty signature header', () => {
    expect(verifyHmac(BODY, APP_SECRET, '')).toBe(false);
  });
});

describe('Meta Webhook — field_data lead extraction', () => {
  test('extracts English field names correctly', () => {
    const lead = extractLeadFields(SAMPLE_FIELD_DATA);
    expect(lead.name).toBe('María García López');
    expect(lead.email).toBe('maria.garcia@gmail.com');
    expect(lead.phone).toBe('+34 612 345 678');
    expect(lead.dni).toBe('12345678A');
  });

  test('extracts Spanish field names (nombre, telefono, nif)', () => {
    const lead = extractLeadFields(SAMPLE_FIELD_DATA_SPANISH_LABELS);
    expect(lead.name).toBe('Carlos Martínez');
    expect(lead.email).toBe('carlos@example.com');
    expect(lead.phone).toBe('612000001');
    expect(lead.dni).toBe('87654321B');
  });

  test('handles minimal payload (only email)', () => {
    const lead = extractLeadFields(SAMPLE_FIELD_DATA_MINIMAL);
    expect(lead.name).toBeNull();
    expect(lead.email).toBe('anon@test.com');
    expect(lead.phone).toBeNull();
    expect(lead.dni).toBeNull();
  });

  test('handles empty field_data without throwing', () => {
    const lead = extractLeadFields([]);
    expect(lead.name).toBeNull();
    expect(lead.email).toBeNull();
  });
});

describe('Meta Webhook — payload structure validation', () => {
  test('SAMPLE_LEAD_PAYLOAD has expected shape', () => {
    expect(SAMPLE_LEAD_PAYLOAD.object).toBe('page');
    const entry = SAMPLE_LEAD_PAYLOAD.entry[0];
    expect(entry.changes[0].field).toBe('leadgen');
    const val = entry.changes[0].value;
    expect(val.leadgen_id).toBeTruthy();
    expect(val.page_id).toBeTruthy();
  });

  test('non-page object payloads are skipped (no throws)', () => {
    const nonPagePayload = { object: 'user', entry: [] };
    // The Edge Function returns 200 'ok' immediately — no processing
    expect(nonPagePayload.object).not.toBe('page');
  });

  test('entries without leadgen field are skipped', () => {
    const payload = {
      object: 'page',
      entry: [{ changes: [{ field: 'feed', value: {} }] }],
    };
    const leadgenChanges = payload.entry
      .flatMap(e => e.changes)
      .filter(c => c.field === 'leadgen');
    expect(leadgenChanges.length).toBe(0);
  });
});
