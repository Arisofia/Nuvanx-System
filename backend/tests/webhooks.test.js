'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
process.env.META_APP_SECRET = '';
process.env.META_VERIFY_TOKEN = 'test-meta-verify-token';

const request = require('supertest');

const app = require('../src/server');

describe('Webhooks API', () => {
  test('GET /api/webhooks/meta - verifies with correct token', async () => {
    const res = await request(app)
      .get('/api/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-meta-verify-token',
        'hub.challenge': 'test-challenge-123',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('test-challenge-123');
  });

  test('GET /api/webhooks/meta - rejects wrong verify token', async () => {
    const res = await request(app)
      .get('/api/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'test-challenge',
      });

    expect(res.status).toBe(403);
  });

  test('POST /api/webhooks/meta - skips non-page/whatsapp objects', async () => {
    const res = await request(app)
      .post('/api/webhooks/meta')
      .send({ object: 'user', entry: [] });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
  });

  test('POST /api/webhooks/meta - processes leadgen entry', async () => {
    const res = await request(app)
      .post('/api/webhooks/meta')
      .send({
        object: 'page',
        entry: [
          {
            id: '12345',
            time: Date.now(),
            changes: [
              {
                field: 'leadgen',
                value: { leadgen_id: 'lg_001', page_id: 'p_001', form_id: 'f_001' },
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(typeof res.body.processed).toBe('number');
  });
});

describe('Meta Webhook API', () => {
  test('GET /api/webhooks/meta - verifies subscription when token matches', async () => {
    const res = await request(app)
      .get('/api/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-meta-verify-token',
        'hub.challenge': 'challenge_code_123',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge_code_123');
  });

  test('GET /api/webhooks/meta - rejects invalid verify token', async () => {
    const res = await request(app)
      .get('/api/webhooks/meta')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge_code',
      });

    expect(res.status).toBe(403);
  });

  test('POST /api/webhooks/meta - skips non-page objects', async () => {
    const res = await request(app)
      .post('/api/webhooks/meta')
      .send({ object: 'user', entry: [] });

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
  });

  test('POST /api/webhooks/meta - processes page leadgen events', async () => {
    const res = await request(app)
      .post('/api/webhooks/meta')
      .send({
        object: 'page',
        entry: [{
          id: 'page-123',
          time: Date.now(),
          changes: [{
            field: 'leadgen',
            value: { leadgen_id: 'lead-456', page_id: 'page-123', form_id: 'form-789' },
          }],
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.processed).toBeGreaterThanOrEqual(0);
  });
});
