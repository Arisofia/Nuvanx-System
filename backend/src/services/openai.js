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
async function generateContent(apiKey, prompt, model = 'gpt-4') {
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
    const errorMessage = err.response?.data?.error?.message || err.message;
    logger.error('OpenAI API Error in generateContent', {
      status: err.response?.status,
      error: errorMessage,
    });
    throw new Error(`OpenAI Error: ${errorMessage}`);
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

  try {
    const raw = await generateContent(apiKey, prompt, 'gpt-4');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('OpenAI analyzeCampaign: response did not contain JSON', { preview: raw.substring(0, 120) });
      return { suggestions: [raw], score: 0 };
    }
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn('OpenAI analyzeCampaign error', { error: err.message });
    return { suggestions: [`Error analizando datos: ${err.message}`], score: 0 };
  }
}

module.exports = { generateContent, analyzeCampaign };
