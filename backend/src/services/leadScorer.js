'use strict';

/**
 * Lead scoring service.
 *
 * Calls the configured AI provider to score a lead (0–100 scale) based on
 * conversion likelihood, then persists the result with full provenance in
 * public.lead_scores.
 *
 * Designed to run as a step inside the playbook runner after lead creation,
 * but can also be invoked directly from any route or service.
 *
 * Usage:
 *   const { scoreLead } = require('./leadScorer');
 *   const result = await scoreLead(userId, lead);
 *   // result: { score: 72.5, provider: 'openai', rationale: { ... } } | null
 */

const { pool, isAvailable } = require('../db');
const credentialModel = require('../models/credential');
const openaiService = require('./openai');
const geminiService = require('./gemini');
const { config } = require('../config/env');
const logger = require('../utils/logger');

const SCORE_VERSION = 1;

function _getService(provider) {
  if (provider === 'gemini') return geminiService;
  return openaiService;
}

/**
 * Resolve the best available AI credential for a user.
 * Falls back: vault openai → vault gemini → env openai → env gemini.
 */
async function _resolveCredential(userId) {
  const openaiKey = await credentialModel.getDecryptedKey(userId, 'openai');
  if (openaiKey) return { key: openaiKey, provider: 'openai' };

  const geminiKey = await credentialModel.getDecryptedKey(userId, 'gemini');
  if (geminiKey) return { key: geminiKey, provider: 'gemini' };

  if (config.openaiApiKey) return { key: config.openaiApiKey, provider: 'openai' };
  if (config.geminiApiKey) return { key: config.geminiApiKey, provider: 'gemini' };

  return null;
}

/**
 * Score a single lead using AI and persist the result to lead_scores.
 *
 * @param {string} userId  UUID of the user who owns the lead.
 * @param {object} lead    Lead with { id, name, email, phone, source, stage, notes }.
 * @returns {{ score: number, provider: string, rationale: object } | null}
 *   Returns null when no AI credential is available, the lead has no id, or
 *   the AI response cannot be parsed.
 */
async function scoreLead(userId, lead) {
  if (!lead?.id) {
    logger.warn('[leadScorer] lead has no id — skipping');
    return null;
  }

  const credential = await _resolveCredential(userId);
  if (!credential) {
    logger.debug('[leadScorer] no AI credential available — skipping lead score', {
      leadId: lead.id,
    });
    return null;
  }

  const prompt = `You are a clinic revenue analyst. Score the following lead on a scale of 0 to 100 based on conversion likelihood. Higher scores indicate stronger intent and completeness.

Lead data:
- Name: ${lead.name || 'unknown'}
- Source: ${lead.source || 'unknown'}
- Stage: ${lead.stage || 'lead'}
- Phone: ${lead.phone ? 'provided' : 'missing'}
- Email: ${lead.email ? 'provided' : 'missing'}
- Notes: ${lead.notes ? String(lead.notes).substring(0, 200) : 'none'}

Respond ONLY with valid JSON:
{ "score": <number 0-100>, "rationale": { "key_factor": "<string>", "risk": "<string>" } }`;

  let rawResponse;
  try {
    const service = _getService(credential.provider);
    rawResponse = await service.generateContent(credential.key, prompt);
  } catch (err) {
    logger.warn('[leadScorer] AI call failed', { leadId: lead.id, error: err.message });
    return null;
  }

  let score = null;
  let rationale = {};
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.score === 'number') {
        score = Math.min(100, Math.max(0, parsed.score));
      }
      rationale = parsed.rationale && typeof parsed.rationale === 'object'
        ? parsed.rationale
        : {};
    }
  } catch (parseErr) {
    logger.warn('[leadScorer] could not parse AI response', {
      leadId: lead.id,
      error: parseErr.message,
    });
  }

  if (score === null) return null;

  if (isAvailable()) {
    try {
      await pool.query(
        `INSERT INTO public.lead_scores (lead_id, score, provider, model, version, scored_at, rationale)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6)
         ON CONFLICT (lead_id) DO UPDATE SET
           score      = EXCLUDED.score,
           provider   = EXCLUDED.provider,
           model      = EXCLUDED.model,
           version    = EXCLUDED.version,
           scored_at  = NOW(),
           rationale  = EXCLUDED.rationale`,
        [lead.id, score, credential.provider, null, SCORE_VERSION, JSON.stringify(rationale)],
      );
      logger.info('[leadScorer] score persisted', {
        leadId: lead.id,
        score,
        provider: credential.provider,
      });
    } catch (dbErr) {
      logger.warn('[leadScorer] could not persist score', { leadId: lead.id, error: dbErr.message });
    }
  }

  return { score, provider: credential.provider, rationale };
}

module.exports = { scoreLead };
