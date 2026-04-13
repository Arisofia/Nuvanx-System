'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const integrationModel = require('../models/integration');
const credentialModel = require('../models/credential');
const metaService = require('../services/meta');
const googleService = require('../services/google');
const whatsappService = require('../services/whatsapp');
const githubService = require('../services/github');
const hubspotService = require('../services/hubspot');
const { config } = require('../config/env');
const { serviceParamRule, handleValidationErrors, connectRules } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/**
 * Resolve a credential for the given service (async).
 * Priority: per-user vault → server-level env var defaults.
 */
async function resolveCredential(userId, service) {
  const stored = await credentialModel.getDecryptedKey(userId, service);
  if (stored) return stored;

  // Env-var fallbacks keyed by service name
  const envDefaults = {
    openai: config.openaiApiKey,
    gemini: config.geminiApiKey,
    'google-calendar': config.googleApiKey,
    'google-gmail': config.googleApiKey,
    hubspot: config.hubspotAccessToken || config.hubspotApiKey,
    meta: config.metaAccessToken,
    whatsapp: config.whatsappAccessToken,
  };
  return envDefaults[service] || null;
}

/** GET /api/integrations - list all integrations with their status */
router.get('/', async (req, res, next) => {
  try {
    const integrations = await integrationModel.getAll(req.user.id);
    res.json({ success: true, integrations });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/integrations/validate-all
 * Test every service that has an available credential (vault or env-var).
 * WhatsApp is skipped (requires phoneNumberId which is not available here).
 * Runs all tests in parallel and returns the aggregated results.
 */
router.get('/validate-all', async (req, res, next) => {
  try {
  const userId = req.user.id;

  // Services testable without extra parameters
  const TESTABLE = [
    { service: 'meta', test: (k) => metaService.testConnection(k) },
    { service: 'google-calendar', test: (k) => googleService.testConnection(k) },
    { service: 'google-gmail', test: (k) => googleService.testConnection(k) },
    { service: 'github', test: (k) => githubService.testConnection(k) },
    { service: 'hubspot', test: (k) => hubspotService.testConnection(k) },
    {
      service: 'openai',
      test: () => Promise.resolve({ connected: false, stored: true, message: 'Credential present — not validated in bulk check' }),
    },
    {
      service: 'gemini',
      test: () => Promise.resolve({ connected: false, stored: true, message: 'Credential present — not validated in bulk check' }),
    },
  ];

  const results = await Promise.allSettled(
    TESTABLE.map(async ({ service, test }) => {
      const credential = await resolveCredential(userId, service);
      if (!credential) {
        return { service, status: 'disconnected', connected: false, skipped: true };
      }

      try {
        const result = await test(credential);
        const status = result.connected ? 'connected' : result.stored ? 'stored' : 'error';
        await integrationModel.upsert(userId, service, {
          status,
          lastSync: result.connected ? new Date().toISOString() : undefined,
          lastError: result.error || null,
          metadata: {
            accountName: result.accountName,
            login: result.login,
            email: result.email,
            portalId: result.portalId,
          },
        });
        return { service, status, connected: result.connected, ...result };
      } catch (err) {
        await integrationModel.upsert(userId, service, { status: 'error', lastError: err.message });
        return { service, status: 'error', connected: false, error: err.message };
      }
    }),
  );

  const validated = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { service: TESTABLE[i].service, status: 'error', connected: false, error: r.reason?.message },
  );
  const connected = validated.filter((r) => r.connected).length;
  logger.info('validate-all completed', { userId, connected, total: validated.length });

  res.json({ success: true, validated, connected, total: validated.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/integrations/whatsapp/phone-numbers
 * Discover all WhatsApp phone numbers and their IDs registered to this business.
 * Uses the stored WHATSAPP_ACCESS_TOKEN (vault or env-var fallback).
 */
router.get('/whatsapp/phone-numbers', async (req, res, next) => {
  try {
    const token = await resolveCredential(req.user.id, 'whatsapp');
    if (!token) {
      return res.status(404).json({ success: false, message: 'No WhatsApp credential found. Set WHATSAPP_ACCESS_TOKEN.' });
    }
    const phoneNumbers = await whatsappService.discoverPhoneNumbers(token);
    logger.info('WhatsApp phone numbers discovered', { userId: req.user.id, count: phoneNumbers.length });
    res.json({ success: true, phoneNumbers });
  } catch (err) {
    next(err);
  }
});

/** POST /api/integrations/:service/test - test stored credential connection */
router.post(
  '/:service/test',
  serviceParamRule,
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    try {
      const apiKey = await resolveCredential(req.user.id, service);
      if (!apiKey) {
        return res.status(404).json({ success: false, message: `No credential found for ${service}` });
      }

      let result;
      switch (service) {
        case 'meta':
          result = await metaService.testConnection(apiKey);
          break;
        case 'google-calendar':
        case 'google-gmail':
          result = await googleService.testConnection(apiKey);
          break;
        case 'whatsapp': {
          const phoneNumberId = req.body.phoneNumberId;
          if (!phoneNumberId) {
            return res.status(400).json({ success: false, message: 'phoneNumberId is required for WhatsApp' });
          }
          result = await whatsappService.testConnection(apiKey, phoneNumberId);
          break;
        }
        case 'github':
          result = await githubService.testConnection(apiKey);
          break;
        case 'hubspot':
          result = await hubspotService.testConnection(apiKey);
          break;
        case 'openai':
        case 'gemini':
          // Basic key presence check — real validation happens on first generate call
          result = { connected: true, message: 'Credential stored and accessible' };
          break;
        default:
          return res.status(400).json({ success: false, message: 'Unknown service' });
      }

      const status = result.connected ? 'connected' : 'error';
      await integrationModel.upsert(req.user.id, service, {
        status,
        lastSync: result.connected ? new Date().toISOString() : undefined,
        lastError: result.error || null,
        metadata: {
          accountName: result.accountName,
          login: result.login,
          email: result.email,
          portalId: result.portalId,
        },
      });

      logger.info('Integration test', { userId: req.user.id, service, connected: result.connected });
      res.json({ success: true, service, ...result });
    } catch (err) {
      await integrationModel.upsert(req.user.id, service, { status: 'error', lastError: err.message });
      next(err);
    }
  },
);

/** POST /api/integrations/:service/connect - store OAuth token and mark connected */
router.post(
  '/:service/connect',
  serviceParamRule,
  connectRules,
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    const { token, apiKey, metadata = {} } = req.body;
    const credential = token || apiKey;

    if (!credential) {
      return res.status(400).json({ success: false, message: 'token or apiKey is required' });
    }

    try {
      await credentialModel.save(req.user.id, service, credential);
      await integrationModel.upsert(req.user.id, service, {
        status: 'connected',
        lastSync: new Date().toISOString(),
        lastError: null,
        metadata,
      });
      logger.info('Integration connected', { userId: req.user.id, service });
      res.json({ success: true, message: `${service} connected successfully` });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
