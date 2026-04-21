'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const credentialModel = require('../models/credential');
const { credentialRules, serviceParamRule, handleValidationErrors } = require('../utils/validators');
const { credentialsWriteLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const router = express.Router();

// All credential routes require authentication
router.use(authenticate);

/** GET /api/credentials - list stored services (metadata only, no keys) */
router.get('/', async (req, res, next) => {
  try {
    const credentials = await credentialModel.listByUser(req.user.id);
    res.json({ success: true, credentials });
  } catch (err) {
    next(err);
  }
});

/** POST /api/credentials - save or update a credential (encrypted) */
router.post('/', credentialsWriteLimiter, credentialRules, handleValidationErrors, async (req, res, next) => {
  try {
    const { service, apiKey } = req.body;
    const meta = await credentialModel.save(req.user.id, service, apiKey);
    logger.info('Credential saved', { userId: req.user.id, service });
    res.status(201).json({ success: true, credential: meta });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/credentials/:service - remove a credential */
router.delete('/:service', serviceParamRule, handleValidationErrors, async (req, res, next) => {
  try {
    const { service } = req.params;
    const deleted = await credentialModel.remove(req.user.id, service);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Credential not found' });
    }

    // Cascade: mark integration as disconnected when its credential is removed
    try {
      const integrationModel = require('../models/integration');
      await integrationModel.upsert(req.user.id, service, {
        status: 'disconnected',
        lastError: 'credential removed',
      });
    } catch (cascadeErr) {
      logger.warn('Failed to cascade integration status on credential delete', { error: cascadeErr.message });
    }

    logger.info('Credential deleted', { userId: req.user.id, service });
    res.json({ success: true, message: `Credential for ${service} deleted` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
