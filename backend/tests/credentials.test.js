'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');

const TEST_USER = { id: 'user-001', email: 'test@example.com', name: 'Test User' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Credentials API', () => {
  test('POST /api/credentials - saves a credential and returns metadata only', async () => {
    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', authHeader)
      .send({ service: 'github', apiKey: 'ghp_secretTokenValue123' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.credential).toHaveProperty('id');
    expect(res.body.credential.service).toBe('github');
    expect(res.body.credential).not.toHaveProperty('apiKey');
    expect(res.body.credential).not.toHaveProperty('encryptedKey');
  });

  test('GET /api/credentials - lists credentials without exposing raw keys', async () => {
    const res = await request(app)
      .get('/api/credentials')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.credentials)).toBe(true);

    for (const cred of res.body.credentials) {
      expect(cred).not.toHaveProperty('apiKey');
      expect(cred).not.toHaveProperty('encryptedKey');
      expect(cred).toHaveProperty('service');
      expect(cred).toHaveProperty('id');
    }
  });

  test('DELETE /api/credentials/:service - removes a credential', async () => {
    // First save one
    await request(app)
      .post('/api/credentials')
      .set('Authorization', authHeader)
      .send({ service: 'openai', apiKey: 'sk-openai-secret-key' });

    const del = await request(app)
      .delete('/api/credentials/openai')
      .set('Authorization', authHeader);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
  });

  test('DELETE /api/credentials/:service - 404 if not found', async () => {
    const res = await request(app)
      .delete('/api/credentials/gemini')
      .set('Authorization', authHeader);

    expect(res.status).toBe(404);
  });

  test('POST /api/credentials - 400 on invalid service', async () => {
    const res = await request(app)
      .post('/api/credentials')
      .set('Authorization', authHeader)
      .send({ service: 'unknown-service', apiKey: 'abc' });

    expect(res.status).toBe(400);
  });

  test('GET /api/credentials - 401 without token', async () => {
    const res = await request(app).get('/api/credentials');
    expect(res.status).toBe(401);
  });
});
