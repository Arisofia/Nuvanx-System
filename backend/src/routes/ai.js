'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/rateLimiter');
const credentialModel = require('../models/credential');
const openaiService = require('../services/openai');
const geminiService = require('../services/gemini');
const { supabaseAdmin } = require('../config/supabase');
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

async function persistAgentOutput(userId, agentType, output, metadata = {}) {
  if (!supabaseAdmin) {
    logger.warn('Supabase admin client unavailable for agent output persistence', { userId, agentType });
    return;
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('clinic_id')
    .eq('id', userId)
    .single();

  if (userError) {
    logger.warn('Unable to resolve user clinic for agent output persistence', { userId, error: userError.message });
  }

  const record = {
    user_id: userId,
    clinic_id: user?.clinic_id || null,
    agent_type: agentType,
    output,
    metadata,
  };

  const { error: insertError } = await supabaseAdmin.from('agent_outputs').insert(record);
  if (insertError) {
    logger.warn('Failed to persist agent output', { userId, agentType, error: insertError.message });
  }
}

/** GET /api/ai/status — check whether an AI credential is available for the current user */
router.get('/status', async (req, res, next) => {
  try {
    const credential = await resolveAiCredential(req.user.id, 'openai');
    res.json({
      success: true,
      available: credential !== null,
      provider: credential?.provider || null,
    });
  } catch (err) {
    next(err);
  }
});

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
    await persistAgentOutput(req.user.id, 'generate', content, {
      model,
      requestedProvider: provider,
      executedProvider: credential.provider,
      promptLength: prompt.length,
    });

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
      await persistAgentOutput(req.user.id, 'analyze_campaign', analysis, {
        requestedProvider: provider,
        executedProvider: credential.provider,
        campaignDataSummary: {
          fields: Object.keys(campaignData || {}).length,
        },
      });

      res.json({ success: true, analysis, provider: credential.provider });
    } catch (err) {
      logger.error('AI analyze-campaign error', { error: err.message });
      next(err);
    }
  },
);

/**
 * POST /api/ai/suggestions
 * Generate AI-powered optimization suggestions based on real campaign data.
 * Fetches actual Meta and lead data to generate actionable insights.
 */
router.post('/suggestions', async (req, res, next) => {
  try {
    const { provider = 'openai' } = req.body;
    const userId = req.user.id;

    // Get AI credential
    const credential = await resolveAiCredential(userId, provider);
    if (!credential) {
      return res.status(404).json({
        success: false,
        message: 'No AI credential found. Please add an OpenAI or Gemini API key in Settings.',
      });
    }

    // Fetch real data from the system
    const leadModel = require('../models/lead');
    const integrationModel = require('../models/integration');
    const metaService = require('../services/meta');

    const [leads, integrations] = await Promise.all([
      leadModel.findByUser(userId),
      integrationModel.getAll(userId),
    ]);

    // Build comprehensive data summary for AI analysis
    const totalLeads = leads.length;
    const totalRevenue = leads.reduce((sum, l) => sum + (l.revenue || 0), 0);
    const conversions = leads.filter(l => l.stage === 'treatment' || l.stage === 'closed').length;
    const conversionRate = totalLeads > 0 ? ((conversions / totalLeads) * 100).toFixed(1) : 0;

    const byStage = {};
    leads.forEach(lead => {
      byStage[lead.stage] = (byStage[lead.stage] || 0) + 1;
    });

    const bySource = {};
    leads.forEach(lead => {
      bySource[lead.source] = (bySource[lead.source] || 0) + 1;
    });

    const connectedServices = integrations.filter(i => i.status === 'connected').map(i => i.service);

    // Try to fetch Meta metrics if connected
    let metaMetrics = null;
    const metaIntegration = integrations.find(i => i.service === 'meta' && i.status === 'connected');
    if (metaIntegration) {
      try {
        const metaToken = await credentialModel.getDecryptedKey(userId, 'meta');
        const adAccountId = metaIntegration.metadata?.adAccountId;
        if (metaToken && adAccountId) {
          const insights = await metaService.getMetrics(metaToken, adAccountId);
          if (insights.length > 0) {
            metaMetrics = insights[0];
          }
        }
      } catch (err) {
        logger.warn('Could not fetch Meta metrics for AI suggestions', { error: err.message });
      }
    }

    // Build prompt for AI
    const prompt = `You are a revenue intelligence expert for aesthetic clinics. Analyze the following REAL business data and provide 3-5 specific, actionable optimization suggestions.

**Current Performance:**
- Total Leads: ${totalLeads}
- Total Revenue: $${totalRevenue.toFixed(2)}
- Conversions: ${conversions}
- Conversion Rate: ${conversionRate}%
- Lead Pipeline: ${JSON.stringify(byStage)}
- Lead Sources: ${JSON.stringify(bySource)}
- Connected Integrations: ${connectedServices.join(', ') || 'None'}

${metaMetrics ? `**Meta Ads Performance:**
- Impressions: ${metaMetrics.impressions}
- Reach: ${metaMetrics.reach}
- Clicks: ${metaMetrics.clicks}
- Spend: $${metaMetrics.spend}
- CTR: ${metaMetrics.ctr}%
- CPC: $${metaMetrics.cpc}
- CPM: $${metaMetrics.cpm}
` : '**Meta Ads:** Not connected'}

Provide suggestions as a JSON array of strings. Each suggestion should be specific, measurable, and immediately actionable. Focus on:
1. Improving conversion rates
2. Optimizing marketing spend
3. Better lead nurturing
4. Integration opportunities
5. Revenue growth tactics

Respond ONLY with valid JSON: ["suggestion 1", "suggestion 2", "suggestion 3", ...]`;

    const service = getAiService(credential.provider);
    const rawResponse = await service.generateContent(credential.key, prompt);

    // Parse JSON response
    let suggestions = [];
    try {
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: split by lines and clean up
        suggestions = rawResponse
          .split('\n')
          .filter(line => line.trim().length > 20)
          .slice(0, 5);
      }
    } catch (err) {
      logger.warn('Could not parse AI suggestions as JSON, using raw text', { error: err.message });
      suggestions = [rawResponse];
    }

    logger.info('AI suggestions generated', { userId, provider: credential.provider, count: suggestions.length });
    await persistAgentOutput(userId, 'suggestions', suggestions, {
      provider: credential.provider,
      leads: totalLeads,
      revenue: totalRevenue,
      metaConnected: !!metaMetrics,
      integrationsConnected: connectedServices.length,
    });

    res.json({
      success: true,
      suggestions,
      provider: credential.provider,
      dataSource: {
        leads: totalLeads,
        revenue: totalRevenue,
        metaConnected: !!metaMetrics,
        integrationsConnected: connectedServices.length,
      },
    });
  } catch (err) {
    logger.error('AI suggestions error', { error: err.message });
    next(err);
  }
});

module.exports = router;
