'use strict';

const { pool, isAvailable } = require('../db');
const { config } = require('../config/env');
const openaiService = require('./openai');
const geminiService = require('./gemini');
const logger = require('../utils/logger');

function sanitize(value) {
  if (!value) return '';
  return String(value)
    .replace(/[`$<>]/g, '')
    .replace(/(ignore previous|system prompt|developer mode|tool call)/gi, '')
    .slice(0, 500);
}

function heuristicScore(lead) {
  let score = 35;
  if (lead.phone) score += 20;
  if (lead.email) score += 15;
  if ((lead.source || '').toLowerCase().includes('meta')) score += 15;
  if ((lead.stage || '').toLowerCase() === 'appointment') score += 10;
  if ((lead.stage || '').toLowerCase() === 'treatment') score += 20;
  return Math.max(0, Math.min(100, score));
}

async function aiScore(lead) {
  const apiKey = config.openaiApiKey || config.geminiApiKey;
  if (!apiKey) return null;

  const payload = {
    name: sanitize(lead.name),
    email: sanitize(lead.email),
    phone: sanitize(lead.phone),
    source: sanitize(lead.source),
    stage: sanitize(lead.stage),
    notes: sanitize(lead.notes),
  };

  const prompt = `Score this lead from 0 to 100 and return only JSON with fields score and reason. Data: ${JSON.stringify(payload)}`;
  const raw = config.openaiApiKey
    ? await openaiService.generateContent(config.openaiApiKey, prompt)
    : await geminiService.generateContent(config.geminiApiKey, prompt);

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const n = Number(parsed.score);
    if (!Number.isFinite(n)) return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(n))),
      reason: sanitize(parsed.reason || 'ai'),
      model: config.openaiApiKey ? 'openai' : 'gemini',
    };
  } catch {
    return null;
  }
}

async function persistScore({ userId, leadId, score, method, reason, metadata = {} }) {
  if (!isAvailable()) return;
  try {
    await pool.query(
      `INSERT INTO public.lead_scores (lead_id, user_id, score, method, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leadId, userId, score, method, reason, JSON.stringify(metadata)],
    );
  } catch (err) {
    logger.warn('[lead-scorer] persist failed', { leadId, error: err.message });
  }
}

async function scoreLead(userId, lead) {
  const ai = await aiScore(lead);
  if (ai) {
    await persistScore({
      userId,
      leadId: lead.id,
      score: ai.score,
      method: 'ai',
      reason: ai.reason,
      metadata: { model: ai.model },
    });
    return { score: ai.score, method: 'ai', reason: ai.reason };
  }

  const fallback = heuristicScore(lead);
  await persistScore({
    userId,
    leadId: lead.id,
    score: fallback,
    method: 'heuristic',
    reason: 'fallback_heuristic',
  });
  return { score: fallback, method: 'heuristic', reason: 'fallback_heuristic' };
}

module.exports = { scoreLead, sanitize, heuristicScore };