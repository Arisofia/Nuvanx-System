'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');

const SUPABASE_TEST_SECRET = 'supabase-test-secret-32-chars-min!';
const TEST_USER = { id: 'user-001', email: 'test@nuvanx.com', name: 'Test User' };

describe('Auth middleware — custom JWT', () => {
  let app;

  beforeAll(() => {
    // Ensure no Supabase secret leaks from a prior test run
    delete process.env.SUPABASE_JWT_SECRET;
    // Re-require to pick up clean env
    jest.resetModules();
    app = require('../src/server');
  });

  test('valid custom JWT is accepted (200)', async () => {
    const token = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('missing Authorization header returns 401', async () => {
    const res = await request(app).get('/api/integrations');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Authorization token required/i);
  });

  test('expired custom JWT returns 401 with "Token expired"', async () => {
    const token = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: -1 });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Token expired/i);
  });

  test('invalid custom JWT (bad secret) returns 401', async () => {
    const token = jwt.sign(TEST_USER, 'wrong-secret-32-chars-minimum!!!', { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid token/i);
  });
});

describe('Auth middleware — Supabase JWT', () => {
  let app;

  beforeAll(() => {
    process.env.SUPABASE_JWT_SECRET = SUPABASE_TEST_SECRET;
    jest.resetModules();
    app = require('../src/server');
  });

  afterAll(() => {
    delete process.env.SUPABASE_JWT_SECRET;
  });

  test('valid Supabase JWT is accepted and sub→id is normalized', async () => {
    // Supabase tokens use "sub" for the user UUID
    const payload = {
      sub: 'supabase-user-uuid-001',
      email: 'sb@nuvanx.com',
      user_metadata: { name: 'Supabase User' },
      aud: 'authenticated',
      role: 'authenticated',
    };
    const token = jwt.sign(payload, SUPABASE_TEST_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('valid custom JWT is still accepted when SUPABASE_JWT_SECRET is set', async () => {
    const token = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('expired Supabase JWT returns 401 with "Token expired"', async () => {
    const payload = { sub: 'supabase-user-uuid-002', email: 'exp@nuvanx.com' };
    const token = jwt.sign(payload, SUPABASE_TEST_SECRET, { expiresIn: -1 });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Token expired/i);
  });

  test('Supabase JWT signed with wrong secret returns 401', async () => {
    const payload = { sub: 'supabase-user-uuid-003', email: 'bad@nuvanx.com' };
    const token = jwt.sign(payload, 'wrong-supabase-secret-32-chars!!!', { expiresIn: '1h' });
    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid token/i);
  });
});
