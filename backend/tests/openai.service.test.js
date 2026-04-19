'use strict';

process.env.JWT_SECRET = 'test-jwt-secret-32-chars-minimum!!';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-min!';
process.env.NODE_ENV = 'test';

jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const axios = require('axios');
const logger = require('../src/utils/logger');
const { generateContent, analyzeCampaign } = require('../src/services/openai');

describe('openai service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generateContent surfaces OpenAI API error message', async () => {
    axios.post.mockRejectedValue({
      response: {
        status: 401,
        data: { error: { message: 'Incorrect API key provided' } },
      },
    });

    await expect(generateContent('bad-key', 'hola', 'gpt-4')).rejects.toThrow(
      'OpenAI Error: Incorrect API key provided',
    );

    expect(logger.error).toHaveBeenCalled();
  });

  test('analyzeCampaign returns visible fallback payload on provider error', async () => {
    axios.post.mockRejectedValue(new Error('socket hang up'));

    const result = await analyzeCampaign('test-key', { spend: 100, clicks: 10 });

    expect(result.score).toBe(0);
    expect(result.suggestions[0]).toMatch(/Error analyzing data:/i);
    expect(logger.warn).toHaveBeenCalled();
  });
});
