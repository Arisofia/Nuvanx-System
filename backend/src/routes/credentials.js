'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const credentialModel = require('../models/credential');
const { credentialRules, serviceParamRule, handleValidationErrors } = require('../utils/validators');
const logger = require('../utils/logger');

const router = express.Router();

// All credential routes require authentication
router.use(authenticate);

/** GET /api/credentials - list stored services (metadata only, no keys) */
router.get('/', (req, res) => {
  const credentials = credentialModel.listByUser(req.user.id);
  res.json({ success: true, credentials });
});

/** POST /api/credentials - save or update a credential (encrypted) */
router.post('/', credentialRules, handleValidationErrors, (req, res, next) => {
  try {
    const { service, apiKey } = req.body;
    const meta = credentialModel.save(req.user.id, service, apiKey);
    logger.info('Credential saved', { userId: req.user.id, service });
    res.status(201).json({ success: true, credential: meta });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/credentials/:service - remove a credential */
router.delete('/:service', serviceParamRule, handleValidationErrors, (req, res) => {
  const { service } = req.params;
  const deleted = credentialModel.remove(req.user.id, service);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Credential not found' });
  }
  logger.info('Credential deleted', { userId: req.user.id, service });
  res.json({ success: true, message: `Credential for ${service} deleted` });
});

module.exports = router;
