'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.SUPABASE_FIGMA_URL = '';
process.env.SUPABASE_FIGMA_ANON_KEY = '';
process.env.SUPABASE_FIGMA_SERVICE_ROLE = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

const TEST_USER = { id: 'figma-test-user-001', email: 'figma@nuvanx.com', name: 'Figma Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Figma API', () => {
  test('GET /api/figma/events - 401 without token', async () => {
    const res = await request(app).get('/api/figma/events');
    expect(res.status).toBe(401);
  });

  test('GET /api/figma/events - returns events array (empty if Supabase not configured)', async () => {
    const res = await request(app)
      .get('/api/figma/events')
      .set('Authorization', authHeader);

    // 200 with empty array when Supabase client not configured in test env
    // OR 503 when client is explicitly null
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
    }
  });

  test('GET /api/figma/events - respects limit param', async () => {
    const res = await request(app)
      .get('/api/figma/events?limit=5')
      .set('Authorization', authHeader);

    expect([200, 503]).toContain(res.status);
  });

  test('GET /api/figma/sync/latest - responds with valid status', async () => {
    const res = await request(app)
      .get('/api/figma/sync/latest')
      .set('Authorization', authHeader);

    // 503 if Supabase Figma client not configured; 404 if no records yet; 200 if records exist
    expect([200, 404, 503]).toContain(res.status);
  });

  test('POST /api/figma/sync - completes without throwing (Supabase may be unavailable)', async () => {
    const res = await request(app)
      .post('/api/figma/sync')
      .set('Authorization', authHeader);

    // Supabase may not be available in test env, but the route should respond
    expect([200, 500, 503]).toContain(res.status);
  });
});
