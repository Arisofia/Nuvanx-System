'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const credentialModel = require('../models/credential');
const whatsappService = require('../services/whatsapp');
const { config } = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/**
 * POST /api/whatsapp/send
 * Send a WhatsApp text message to a recipient.
 * Body: { to: string (E.164), message: string }
 */
router.post('/send', async (req, res, next) => {
  try {
    const { to, message } = req.body;

    if (!to || typeof to !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing or invalid "to" (E.164 phone number).' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Missing or empty "message".' });
    }

    // Resolve WhatsApp credentials: per-user vault first, then server-level env fallback
    const accessToken = await credentialModel.getDecryptedKey(req.user.id, 'whatsapp') || config.whatsappAccessToken;
    const phoneNumberId = config.whatsappPhoneNumberId;

    if (!accessToken) {
      return res.status(404).json({
        success: false,
        message: 'WhatsApp integration not connected. Please connect WhatsApp in Settings.',
      });
    }
    if (!phoneNumberId) {
      return res.status(400).json({
        success: false,
        message: 'WHATSAPP_PHONE_NUMBER_ID not configured on the server.',
      });
    }

    const result = await whatsappService.sendMessage(accessToken, phoneNumberId, to, message.trim());
    logger.info('WhatsApp message sent', { to, messageId: result.messages?.[0]?.id });

    res.json({ success: true, messageId: result.messages?.[0]?.id });
  } catch (err) {
    logger.error('WhatsApp send error', { error: err.message });
    next(err);
  }
});

/**
 * POST /api/whatsapp/send-template
 * Send a WhatsApp template message.
 * Body: { to: string, templateName: string, languageCode?: string, components?: array }
 */
router.post('/send-template', async (req, res, next) => {
  try {
    const { to, templateName, languageCode, components } = req.body;

    if (!to || typeof to !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing or invalid "to".' });
    }
    if (!templateName || typeof templateName !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing "templateName".' });
    }

    const accessToken = await credentialModel.getDecryptedKey(req.user.id, 'whatsapp') || config.whatsappAccessToken;
    const phoneNumberId = config.whatsappPhoneNumberId;

    if (!accessToken) {
      return res.status(404).json({ success: false, message: 'WhatsApp integration not connected.' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ success: false, message: 'WHATSAPP_PHONE_NUMBER_ID not configured.' });
    }

    const result = await whatsappService.sendTemplateMessage(
      accessToken, phoneNumberId, to, templateName, languageCode || 'es', components || [],
    );

    res.json({ success: true, messageId: result.messages?.[0]?.id });
  } catch (err) {
    logger.error('WhatsApp send-template error', { error: err.message });
    next(err);
  }
});

module.exports = router;
