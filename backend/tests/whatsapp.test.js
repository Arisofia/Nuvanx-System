'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
process.env.META_ACCESS_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';
// No WhatsApp credentials — tests that require them should 404/400
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/services/whatsapp', () => ({
  sendMessage: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.mock001' }] }),
  sendTemplate: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.mock002' }] }),
  testConnection: jest.fn().mockResolvedValue({ connected: true, displayPhoneNumber: '+34600000000' }),
  discoverPhoneNumbers: jest.fn().mockResolvedValue([{ id: '123', displayPhoneNumber: '+34600000000' }]),
}));

const app = require('../src/server');
const whatsappService = require('../src/services/whatsapp');

const TEST_USER = { id: 'wa-test-user-001', email: 'wa@example.com', name: 'WA Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('WhatsApp API', () => {
  test('POST /api/whatsapp/send - 401 without token', async () => {
    const res = await request(app)
      .post('/api/whatsapp/send')
      .send({ to: '+34600000000', message: 'Hola' });
    expect(res.status).toBe(401);
  });

  test('POST /api/whatsapp/send - 400 missing "to"', async () => {
    const res = await request(app)
      .post('/api/whatsapp/send')
      .set('Authorization', authHeader)
      .send({ message: 'Hola' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/whatsapp/send - 400 missing "message"', async () => {
    const res = await request(app)
      .post('/api/whatsapp/send')
      .set('Authorization', authHeader)
      .send({ to: '+34600000000' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/whatsapp/send - 404 when no credential configured', async () => {
    // WHATSAPP_ACCESS_TOKEN is blank and no vault credential for test user
    const res = await request(app)
      .post('/api/whatsapp/send')
      .set('Authorization', authHeader)
      .send({ to: '+34600000000', message: 'Test message' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/whatsapp/send - 400 when credential set but PHONE_NUMBER_ID missing', async () => {
    // Store a credential in vault — but WHATSAPP_PHONE_NUMBER_ID is blank at server start
    await request(app)
      .post('/api/credentials')
      .set('Authorization', authHeader)
      .send({ service: 'whatsapp', apiKey: 'EAAtest_mock_token' });

    const res = await request(app)
      .post('/api/whatsapp/send')
      .set('Authorization', authHeader)
      .send({ to: '+34600000000', message: 'Hola desde test' });

    // 400 = PHONE_NUMBER_ID not configured (token found, but no phone number ID)
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/whatsapp/send-template - 401 without token', async () => {
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .send({ to: '+34600000000', templateName: 'hello_world' });
    expect(res.status).toBe(401);
  });

  test('POST /api/whatsapp/send-template - 400 missing templateName', async () => {
    const res = await request(app)
      .post('/api/whatsapp/send-template')
      .set('Authorization', authHeader)
      .send({ to: '+34600000000' });
    expect(res.status).toBe(400);
  });

  test('GET /api/integrations/whatsapp/phone-numbers - 404 without token', async () => {
    const res = await request(app).get('/api/integrations/whatsapp/phone-numbers');
    expect(res.status).toBe(401);
  });
});
