'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
process.env.GITHUB_TOKEN = '';
process.env.META_ACCESS_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Prevent real external API calls
jest.mock('../src/services/meta', () => ({
  testConnection: jest.fn(),
  getAdInsights: jest.fn(),
}));

const app = require('../src/server');

const TEST_USER = { id: 'dash-test-user-001', email: 'dash@example.com', name: 'Dash Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Dashboard API', () => {
  test('GET /api/dashboard/metrics - 401 without token', async () => {
    const res = await request(app).get('/api/dashboard/metrics');
    expect(res.status).toBe(401);
  });

  test('GET /api/dashboard/metrics - returns correct shape', async () => {
    const res = await request(app)
      .get('/api/dashboard/metrics')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metrics).toHaveProperty('totalLeads');
    expect(res.body.metrics).toHaveProperty('totalRevenue');
    expect(res.body.metrics).toHaveProperty('conversionRate');
    expect(res.body.metrics).toHaveProperty('connectedIntegrations');
    expect(res.body.metrics).toHaveProperty('byStage');
    expect(typeof res.body.metrics.totalLeads).toBe('number');
    expect(typeof res.body.metrics.totalRevenue).toBe('number');
  });

  test('GET /api/dashboard/funnel - returns funnel with stage data', async () => {
    const res = await request(app)
      .get('/api/dashboard/funnel')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.funnel)).toBe(true);
    if (res.body.funnel.length > 0) {
      expect(res.body.funnel[0]).toHaveProperty('stage');
      expect(res.body.funnel[0]).toHaveProperty('count');
      expect(res.body.funnel[0]).toHaveProperty('label');
    }
  });

  test('GET /api/dashboard/revenue-trend - returns trend array', async () => {
    const res = await request(app)
      .get('/api/dashboard/revenue-trend')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.trend)).toBe(true);
  });

  test('GET /api/dashboard/meta-trends - 400 without adAccountId param', async () => {
    const res = await request(app)
      .get('/api/dashboard/meta-trends')
      .set('Authorization', authHeader);

    // No adAccountId → 400 or 404 (no connected Meta integration)
    expect([400, 404]).toContain(res.status);
  });
});
