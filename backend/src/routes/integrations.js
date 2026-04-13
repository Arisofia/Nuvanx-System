'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const integrationModel = require('../models/integration');
const credentialModel = require('../models/credential');
const metaService = require('../services/meta');
const googleService = require('../services/google');
const whatsappService = require('../services/whatsapp');
const githubService = require('../services/github');
const { serviceParamRule, handleValidationErrors } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/** GET /api/integrations - list all integrations with their status */
router.get('/', (req, res) => {
  const integrations = integrationModel.getAll(req.user.id);
  res.json({ success: true, integrations });
});

/** POST /api/integrations/:service/test - test stored credential connection */
router.post(
  '/:service/test',
  serviceParamRule,
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    try {
      const apiKey = credentialModel.getDecryptedKey(req.user.id, service);
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
        case 'openai':
        case 'gemini':
          // Basic key presence check — real validation happens on first generate call
          result = { connected: true, message: 'Credential stored and accessible' };
          break;
        default:
          return res.status(400).json({ success: false, message: 'Unknown service' });
      }

      const status = result.connected ? 'connected' : 'error';
      integrationModel.upsert(req.user.id, service, {
        status,
        lastSync: result.connected ? new Date().toISOString() : undefined,
        lastError: result.error || null,
        metadata: { accountName: result.accountName, login: result.login, email: result.email },
      });

      logger.info('Integration test', { userId: req.user.id, service, connected: result.connected });
      res.json({ success: true, service, ...result });
    } catch (err) {
      integrationModel.upsert(req.user.id, service, { status: 'error', lastError: err.message });
      next(err);
    }
  },
);

/** POST /api/integrations/:service/connect - store OAuth token and mark connected */
router.post(
  '/:service/connect',
  serviceParamRule,
  handleValidationErrors,
  (req, res, next) => {
    const { service } = req.params;
    const { token, metadata = {} } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    try {
      credentialModel.save(req.user.id, service, token);
      integrationModel.upsert(req.user.id, service, {
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
