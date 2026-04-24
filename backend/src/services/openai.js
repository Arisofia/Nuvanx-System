'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const OPENAI_BASE = 'https://api.openai.com/v1';

/**
 * Generate content via the OpenAI Chat Completions API.
 * The API key is passed from the credential vault and NEVER exposed to the frontend.
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} [model='gpt-4']
 * @returns {string} Generated text
 */
async function generateContent(apiKey, prompt, model = 'gpt-4o-mini') {
  try {
    const { data } = await axios.post(
      `${OPENAI_BASE}/chat/completions`,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      },
    );
    return data.choices[0]?.message?.content ?? '';
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message;
    if (
      message.includes('model') &&
      message.includes('does not exist') &&
      model !== 'gpt-4o-mini'
    ) {
      return generateContent(apiKey, prompt, 'gpt-4o-mini');
    }
    throw err;
  }
}

/**
 * Analyse a marketing campaign and return optimisation suggestions.
 * @param {string} apiKey
 * @param {object} campaignData  { name, objective, spend, clicks, impressions, conversions, copy }
 * @returns {{ suggestions: string[], score: number }}
 */
async function analyzeCampaign(apiKey, campaignData) {
  const prompt = `You are a senior digital marketing strategist. Analyse the following campaign data and return:
1. A list of 3-5 specific optimisation suggestions.
2. An overall performance score from 0-100.

Campaign data:
${JSON.stringify(campaignData, null, 2)}

Respond as valid JSON: { "suggestions": [...], "score": <number> }`;

  const raw = await generateContent(apiKey, prompt, 'gpt-4o-mini');
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [raw], score: null };
  } catch (err) {
    logger.warn('OpenAI analyzeCampaign: could not parse JSON response', { error: err.message });
    return { suggestions: [raw], score: null };
  }
}

module.exports = { generateContent, analyzeCampaign };
