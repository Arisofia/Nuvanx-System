'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const credentialModel = require('../models/credential');
const openaiService = require('../services/openai');
const geminiService = require('../services/gemini');
const { config } = require('../config/env');
const { aiGenerateRules, aiAnalyzeRules, handleValidationErrors } = require('../utils/validators');
const { body } = require('express-validator');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate, aiLimiter);

function getAiService(provider) {
  if (provider === 'gemini') return geminiService;
  return openaiService; // default to openai
}

async function resolveAiCredential(userId, provider) {
  const key = await credentialModel.getDecryptedKey(userId, provider);
  if (key) return { key, provider };

  // Fallback 1: try the other provider's vault credential
  const fallback = provider === 'openai' ? 'gemini' : 'openai';
  const fallbackKey = await credentialModel.getDecryptedKey(userId, fallback);
  if (fallbackKey) return { key: fallbackKey, provider: fallback };

  // Fallback 2: server-level env var keys (Codespaces secrets)
  const envKey = provider === 'gemini' ? config.geminiApiKey : config.openaiApiKey;
  if (envKey) return { key: envKey, provider };

  const envFallbackKey = provider === 'gemini' ? config.openaiApiKey : config.geminiApiKey;
  if (envFallbackKey) return { key: envFallbackKey, provider: fallback };

  return null;
}

/** POST /api/ai/generate */
router.post('/generate', aiGenerateRules, handleValidationErrors, async (req, res, next) => {
  try {
    const { prompt, model, provider = 'openai' } = req.body;
    const credential = await resolveAiCredential(req.user.id, provider);

    if (!credential) {
      return res.status(404).json({
        success: false,
        message: 'No AI credential found. Please add an OpenAI or Gemini API key in Settings.',
      });
    }

    const service = getAiService(credential.provider);
    const content = await service.generateContent(credential.key, prompt, model);
    logger.info('AI content generated', { userId: req.user.id, provider: credential.provider });

    res.json({ success: true, content, provider: credential.provider });
  } catch (err) {
    logger.error('AI generate error', { error: err.message });
    next(err);
  }
});

/** POST /api/ai/analyze-campaign */
router.post(
  '/analyze-campaign',
  [...aiAnalyzeRules, body('provider').optional().isString()],
  handleValidationErrors,
  async (req, res, next) => {
    try {
      const { campaignData, provider = 'openai' } = req.body;
      const credential = await resolveAiCredential(req.user.id, provider);

      if (!credential) {
        return res.status(404).json({
          success: false,
          message: 'No AI credential found. Please add an OpenAI or Gemini API key in Settings.',
        });
      }

      const service = getAiService(credential.provider);
      const analysis = await service.analyzeCampaign(credential.key, campaignData);
      logger.info('Campaign analyzed', { userId: req.user.id, provider: credential.provider });

      res.json({ success: true, analysis, provider: credential.provider });
    } catch (err) {
      logger.error('AI analyze-campaign error', { error: err.message });
      next(err);
    }
  },
);

module.exports = router;
