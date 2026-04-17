'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';
process.env.GITHUB_TOKEN = '';
process.env.GITHUB_PAT = '';
process.env.GITHUB_TOKEN_CLASSIC = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/services/github', () => ({
  testConnection: jest.fn().mockResolvedValue({ connected: true, login: 'testuser', name: 'Test User' }),
  listRepositories: jest.fn().mockResolvedValue([
    {
      id: 1,
      name: 'my-repo',
      full_name: 'testuser/my-repo',
      description: 'Test repo',
      private: false,
      html_url: 'https://github.com/testuser/my-repo',
      language: 'JavaScript',
      open_issues_count: 3,
      stargazers_count: 10,
      forks_count: 2,
      updated_at: '2026-04-15T00:00:00Z',
      default_branch: 'main',
    },
  ]),
  getIssues: jest.fn().mockResolvedValue([
    {
      id: 101,
      number: 1,
      title: 'Fix the login bug',
      state: 'open',
      html_url: 'https://github.com/testuser/my-repo/issues/1',
      labels: [{ name: 'bug' }],
      user: { login: 'testuser' },
      created_at: '2026-04-10T00:00:00Z',
      updated_at: '2026-04-14T00:00:00Z',
    },
  ]),
}));

const app = require('../src/server');

const TEST_USER = { id: 'github-test-user-001', email: 'gh@nuvanx.com', name: 'GH Tester' };
const authToken = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('GitHub API', () => {
  test('GET /api/github/repos - 401 without token', async () => {
    const res = await request(app).get('/api/github/repos');
    expect(res.status).toBe(401);
  });

  test('GET /api/github/repos - 404 when no credential stored', async () => {
    // No GitHub credential stored for this test user, no env token
    const res = await request(app)
      .get('/api/github/repos')
      .set('Authorization', authHeader);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/github/repos - returns repos when credential stored', async () => {
    // Store a GitHub credential first
    await request(app)
      .post('/api/credentials')
      .set('Authorization', authHeader)
      .send({ service: 'github', apiKey: 'ghp_test_token_12345' });

    const res = await request(app)
      .get('/api/github/repos')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.repos)).toBe(true);
    expect(res.body.repos[0]).toHaveProperty('name');
    expect(res.body.repos[0]).toHaveProperty('fullName');
    expect(res.body.repos[0]).toHaveProperty('htmlUrl');
  });

  test('GET /api/github/repos/:owner/:repo/issues - returns issues', async () => {
    const res = await request(app)
      .get('/api/github/repos/testuser/my-repo/issues')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues[0]).toHaveProperty('title');
    expect(res.body.issues[0]).toHaveProperty('state');
    expect(res.body.issues[0]).toHaveProperty('number');
  });

  test('GET /api/github/repos/:owner/:repo/issues - 400 on invalid owner chars', async () => {
    const res = await request(app)
      .get('/api/github/repos/bad%20owner/repo/issues')
      .set('Authorization', authHeader);

    expect([400, 404]).toContain(res.status);
  });
});
