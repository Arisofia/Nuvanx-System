'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
// Set service API keys to empty strings BEFORE dotenv.config() runs inside server.js.
// dotenv.config() skips variables that are already set, so empty strings prevent the
// .env file values from leaking into tests that expect 404 on missing credentials.
process.env.GITHUB_PAT = '';
process.env.GITHUB_TOKEN_CLASSIC = '';
process.env.GITHUB_TOKEN = '';
process.env.META_ACCESS_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock external HTTP calls so tests run offline
jest.mock('../src/services/github', () => ({
  testConnection: jest.fn().mockResolvedValue({ connected: true, login: 'octocat', name: 'The Octocat' }),
}));
jest.mock('../src/services/meta', () => ({
  testConnection: jest.fn().mockResolvedValue({ connected: false, error: 'Invalid OAuth access token' }),
}));
jest.mock('../src/services/whatsapp', () => ({
  testConnection: jest.fn().mockResolvedValue({ connected: true, displayPhoneNumber: '+1234567890' }),
}));

const app = require('../src/server');

const TEST_USER = { id: 'integration-user-001', email: 'int@example.com', name: 'Integration Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Integrations API', () => {
  test('GET /api/integrations - returns list with correct shape', async () => {
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.integrations)).toBe(true);
    expect(res.body.integrations.length).toBeGreaterThan(0);

    const services = res.body.integrations.map((i) => i.service);
    expect(services).toContain('meta');
    expect(services).toContain('github');
    expect(services).toContain('openai');
    expect(services).toContain('gemini');

    for (const integration of res.body.integrations) {
      expect(integration).toHaveProperty('service');
      expect(integration).toHaveProperty('status');
      expect(integration).toHaveProperty('lastSync');
      expect(integration).toHaveProperty('lastError');
    }
  });

  test('POST /api/integrations/github/test - tests connection with stored credential', async () => {
    // Store a credential first
    await request(app)
      .post('/api/credentials')
      .set('Authorization', authHeader)
      .send({ service: 'github', apiKey: 'ghp_mock_token_for_testing' });

    const res = await request(app)
      .post('/api/integrations/github/test')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.connected).toBe(true);
    expect(res.body.login).toBe('octocat');
  });

  test('POST /api/integrations/github/test - 404 if no credential stored', async () => {
    const noCredUser = { id: 'user-no-cred', email: 'no@cred.com', name: 'No Cred' };
    const token = jwt.sign(noCredUser, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .post('/api/integrations/github/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('POST /api/integrations/:service/connect - stores token and marks connected', async () => {
    const res = await request(app)
      .post('/api/integrations/meta/connect')
      .set('Authorization', authHeader)
      .send({ token: 'EAABwzLixnjYBAMockToken', metadata: { adAccountId: 'act_123' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('POST /api/integrations/invalid/test - 400 on unknown service', async () => {
    const res = await request(app)
      .post('/api/integrations/twitter/test')
      .set('Authorization', authHeader);

    expect(res.status).toBe(400);
  });

  test('GET /api/integrations - 401 without token', async () => {
    const res = await request(app).get('/api/integrations');
    expect(res.status).toBe(401);
  });
});
