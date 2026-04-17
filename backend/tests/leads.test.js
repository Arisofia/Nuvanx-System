'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

const TEST_USER = { id: 'leads-test-user-001', email: 'leads@nuvanx.com', name: 'Leads Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

let createdLeadId;

describe('Leads API', () => {
  test('GET /api/leads - 401 without token', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
  });

  test('GET /api/leads - returns empty list for new user', async () => {
    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.leads)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('POST /api/leads - creates a lead with valid payload', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', authHeader)
      .send({
        name: 'Test Lead Garcia',
        email: 'testlead@nuvanx.com',
        phone: '+34 612 345 678',
        source: 'manual',
        stage: 'lead',
        revenue: 500,
        notes: 'Created in test',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.lead).toHaveProperty('id');
    expect(res.body.lead.name).toBe('Test Lead Garcia');
    expect(res.body.lead.stage).toBe('lead');
    expect(res.body.lead.revenue).toBe(500);
    createdLeadId = res.body.lead.id;
  });

  test('POST /api/leads - 400 with invalid stage', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', authHeader)
      .send({ name: 'Invalid Stage Lead', stage: 'bogus' });

    expect(res.status).toBe(400);
  });

  test('POST /api/leads - 400 with invalid email', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', authHeader)
      .send({ name: 'Bad Email Lead', email: 'not-an-email' });

    expect(res.status).toBe(400);
  });

  test('GET /api/leads/:id - retrieves the created lead', async () => {
    if (!createdLeadId) return;
    const res = await request(app)
      .get(`/api/leads/${createdLeadId}`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.lead.id).toBe(createdLeadId);
  });

  test('GET /api/leads/:id - 404 for unknown lead', async () => {
    const res = await request(app)
      .get('/api/leads/00000000-0000-0000-0000-000000000000')
      .set('Authorization', authHeader);

    expect(res.status).toBe(404);
  });

  test('PUT /api/leads/:id - updates stage', async () => {
    if (!createdLeadId) return;
    const res = await request(app)
      .put(`/api/leads/${createdLeadId}`)
      .set('Authorization', authHeader)
      .send({ stage: 'whatsapp' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.lead.stage).toBe('whatsapp');
  });

  test('DELETE /api/leads/:id - deletes the lead', async () => {
    if (!createdLeadId) return;
    const res = await request(app)
      .delete(`/api/leads/${createdLeadId}`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('GET /api/leads - stage filter returns only matching leads', async () => {
    const res = await request(app)
      .get('/api/leads?stage=lead')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    if (res.body.leads.length > 0) {
      expect(res.body.leads.every(l => l.stage === 'lead')).toBe(true);
    }
  });
});
