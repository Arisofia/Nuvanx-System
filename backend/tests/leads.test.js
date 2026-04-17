'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

// Lead model no longer has in-memory fallback — provide a stateful mock
const mockStore = new Map();
const mockSTAGES = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];

function mockCreateLead(userId, data) {
  const id = require('crypto').randomUUID();
  const now = new Date().toISOString();
  const lead = {
    id, userId,
    name: data.name || '', email: data.email || '', phone: data.phone || '',
    source: data.source || 'manual',
    stage: mockSTAGES.includes(data.stage) ? data.stage : 'lead',
    revenue: parseFloat(data.revenue) || 0,
    notes: data.notes || '',
    createdAt: now, updatedAt: now,
  };
  mockStore.set(id, lead);
  return lead;
}

jest.mock('../src/models/lead', () => ({
  STAGES: mockSTAGES,
  create: jest.fn(async (userId, data) => mockCreateLead(userId, data)),
  findByUser: jest.fn(async (userId, filters = {}) => {
    const results = [];
    for (const l of mockStore.values()) {
      if (l.userId !== userId) continue;
      if (filters.stage && l.stage !== filters.stage) continue;
      if (filters.source && l.source !== filters.source) continue;
      results.push({ ...l });
    }
    return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }),
  findById: jest.fn(async (id, userId) => {
    const l = mockStore.get(id);
    if (!l || l.userId !== userId) return null;
    return { ...l };
  }),
  update: jest.fn(async (id, userId, data) => {
    const l = mockStore.get(id);
    if (!l || l.userId !== userId) return null;
    const updated = {
      ...l, ...data, id, userId,
      stage: data.stage && mockSTAGES.includes(data.stage) ? data.stage : l.stage,
      updatedAt: new Date().toISOString(),
    };
    mockStore.set(id, updated);
    return updated;
  }),
  remove: jest.fn(async (id, userId) => {
    const l = mockStore.get(id);
    if (!l || l.userId !== userId) return false;
    mockStore.delete(id);
    return true;
  }),
  findOrMerge: jest.fn(async (userId, data) => {
    const phone = (data.phone || '').trim();
    const email = (data.email || '').trim().toLowerCase();
    for (const l of mockStore.values()) {
      if (l.userId !== userId) continue;
      if (phone && l.phone === phone) {
        const merged = { ...l, ...data, userId, updatedAt: new Date().toISOString() };
        mockStore.set(l.id, merged);
        return { lead: merged, merged: true };
      }
      if (email && (l.email || '').toLowerCase() === email) {
        const merged = { ...l, ...data, userId, updatedAt: new Date().toISOString() };
        mockStore.set(l.id, merged);
        return { lead: merged, merged: true };
      }
    }
    const lead = mockCreateLead(userId, data);
    return { lead, merged: false };
  }),
}));

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
