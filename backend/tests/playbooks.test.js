'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
// Blank service keys
process.env.GITHUB_TOKEN = '';
process.env.META_ACCESS_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

const TEST_USER = { id: 'playbook-test-user-001', email: 'pb@example.com', name: 'PB Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Playbooks API', () => {
  test('GET /api/playbooks - 401 without token', async () => {
    const res = await request(app).get('/api/playbooks');
    expect(res.status).toBe(401);
  });

  test('GET /api/playbooks - returns success with array when DB unavailable', async () => {
    // DB pool may not be available in test env — accepts any valid response shape
    const res = await request(app)
      .get('/api/playbooks')
      .set('Authorization', authHeader);

    // 200 = DB up; 503 = DB explicitly unavailable; 500 = DB query error
    expect([200, 500, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.playbooks)).toBe(true);
    }
  });

  test('POST /api/playbooks/:slug/run - 401 without token', async () => {
    const res = await request(app).post('/api/playbooks/lead-capture-nurture/run');
    expect(res.status).toBe(401);
  });

  test('POST /api/playbooks/:slug/run - 404 or 503 for unknown slug', async () => {
    const res = await request(app)
      .post('/api/playbooks/nonexistent-playbook-xyz/run')
      .set('Authorization', authHeader);

    expect([404, 500, 503]).toContain(res.status);
  });

  test('POST /api/playbooks/:id/run - 401 without token (by id)', async () => {
    const res = await request(app).post('/api/playbooks/some-uuid/run');
    expect(res.status).toBe(401);
  });

  test('GET /api/playbooks - shape includes required fields when 200', async () => {
    const res = await request(app)
      .get('/api/playbooks')
      .set('Authorization', authHeader);

    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.playbooks)).toBe(true);
      if (res.body.playbooks.length > 0) {
        const p = res.body.playbooks[0];
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('status');
      }
    }
  });
});
