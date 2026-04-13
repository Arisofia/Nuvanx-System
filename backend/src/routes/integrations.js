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
const { serviceParamRule, handleValidationErrors } = require('../utils/validators');
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
router.get('/validate-all', async (req, res) => {
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
      test: () => Promise.resolve({ connected: true, message: 'Credential stored and accessible' }),
    },
    {
      service: 'gemini',
      test: () => Promise.resolve({ connected: true, message: 'Credential stored and accessible' }),
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
        const status = result.connected ? 'connected' : 'error';
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

  const validated = results.map((r) => (r.status === 'fulfilled' ? r.value : { service: '?', status: 'error', error: r.reason?.message }));
  const connected = validated.filter((r) => r.connected).length;
  logger.info('validate-all completed', { userId, connected, total: validated.length });

  res.json({ success: true, validated, connected, total: validated.length });
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
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    const { token, metadata = {} } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    try {
      await credentialModel.save(req.user.id, service, token);
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
