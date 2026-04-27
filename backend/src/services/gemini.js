'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALLOWED_GEMINI_MODELS = new Set(['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp']);

/**
 * Generate content via the Google Gemini API.
 * The API key is passed from the credential vault and NEVER exposed to the frontend.
 * @param {string} apiKey
 * @param {string} prompt
 * @param {string} [model='gemini-1.5-flash']
 * @returns {string} Generated text
 */
async function generateContent(apiKey, prompt, model = 'gemini-1.5-flash') {
  const safeModel = ALLOWED_GEMINI_MODELS.has(model) ? model : 'gemini-1.5-flash';
  const { data } = await axios.post(
    `${GEMINI_BASE}/models/${safeModel}:generateContent`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    },
    {
      params: { key: apiKey },
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    },
  );
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/**
 * Analyse a campaign using Gemini.
 * @param {string} apiKey
 * @param {object} campaignData
 * @returns {{ suggestions: string[], score: number }}
 */
async function analyzeCampaign(apiKey, campaignData) {
  const prompt = `You are a senior digital marketing strategist. Analyse the following campaign data and return:
1. A list of 3-5 specific optimisation suggestions.
2. An overall performance score from 0-100.

Campaign data:
${JSON.stringify(campaignData, null, 2)}

Respond as valid JSON: { "suggestions": [...], "score": <number> }`;

  const raw = await generateContent(apiKey, prompt);
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [raw], score: null };
  } catch (err) {
    logger.warn('Gemini analyzeCampaign: could not parse JSON response', { error: err.message });
    return { suggestions: [raw], score: null };
  }
}

module.exports = { generateContent, analyzeCampaign };
