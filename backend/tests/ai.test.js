'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
// Blank out AI env keys so resolveAiCredential returns null for most tests
process.env.OPENAI_API_KEY = '';
process.env.OPEN_IA_PLATFORM = '';
process.env.GEMINI_API_KEY = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

const TEST_USER = { id: 'ai-test-user-001', email: 'ai@nuvanx.com', name: 'AI Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('AI API', () => {
  test('GET /api/ai/status - returns available:false when no key configured', async () => {
    const res = await request(app)
      .get('/api/ai/status')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).toHaveProperty('available');
    expect(res.body).toHaveProperty('provider');
    // No vault key and no env key → available should be false
    expect(res.body.available).toBe(false);
    expect(res.body.provider).toBeNull();
  });

  test('GET /api/ai/status - 401 without token', async () => {
    const res = await request(app).get('/api/ai/status');
    expect(res.status).toBe(401);
  });

  test('POST /api/ai/generate - 404 when no credential available', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', authHeader)
      .send({ prompt: 'Write an ad for a laser clinic', provider: 'openai' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/No AI credential/i);
  });

  test('POST /api/ai/analyze-campaign - 404 when no credential available', async () => {
    const res = await request(app)
      .post('/api/ai/analyze-campaign')
      .set('Authorization', authHeader)
      .send({ campaignData: 'ROAS: 2.5, Spend: €500, Leads: 12', provider: 'openai' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/ai/generate - 400 when prompt is missing', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .set('Authorization', authHeader)
      .send({ provider: 'openai' });

    expect(res.status).toBe(400);
  });

  test('POST /api/ai/generate - 401 without token', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({ prompt: 'test', provider: 'openai' });

    expect(res.status).toBe(401);
  });
});
