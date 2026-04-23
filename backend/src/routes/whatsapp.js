'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const credentialModel = require('../models/credential');
const whatsappService = require('../services/whatsapp');
const { config } = require('../config/env');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { normalizePhoneToE164 } = require('../utils/phone');
const { sendMetaCapiEvent, buildExternalIdFromPhone } = require('../services/metaCapi');

const router = express.Router();
router.use(authenticate);

async function recordOutboundConversation({ userId, to, messagePreview, messageType, waMessageId }) {
  if (!supabaseAdmin) return;
  try {
    const { data: usr } = await supabaseAdmin.from('users').select('clinic_id').eq('id', userId).single();
    if (!usr?.clinic_id) return;

    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, first_outbound_at')
      .eq('phone_normalized', to)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const now = new Date().toISOString();

    await supabaseAdmin.from('whatsapp_conversations').insert({
      clinic_id:       usr.clinic_id,
      lead_id:         lead?.id || null,
      phone:           to,
      direction:       'outbound',
      message_type:    messageType || 'text',
      message_preview: messagePreview ? messagePreview.slice(0, 255) : null,
      sent_at:         now,
      wa_message_id:   waMessageId || null,
    });

    if (lead?.id && !lead.first_outbound_at) {
      await supabaseAdmin.from('leads').update({ first_outbound_at: now }).eq('id', lead.id);
      await supabaseAdmin.from('lead_timeline_events').insert({
        lead_id:     lead.id,
        event_type:  'whatsapp_sent',
        payload:     { message_preview: messagePreview?.slice(0, 100), message_type: messageType || 'text' },
        actor:       userId,
        occurred_at: now,
      });
    }
  } catch (err) {
    logger.warn('recordOutboundConversation failed (non-fatal)', { error: err.message });
  }
}

router.post('/send', async (req, res, next) => {
  try {
    const { to, message, leadId } = req.body;
    const normalizedTo = normalizePhoneToE164(to) || to;

    if (!to || typeof to !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing or invalid "to" (E.164 phone number).' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Missing or empty "message".' });
    }

    const accessToken = await credentialModel.getDecryptedKey(req.user.id, 'whatsapp') || config.whatsappAccessToken;
    const phoneNumberId = config.whatsappPhoneNumberId;

    if (!accessToken) {
      return res.status(404).json({ success: false, message: 'WhatsApp integration not connected. Please connect WhatsApp in Settings.' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ success: false, message: 'WHATSAPP_PHONE_NUMBER_ID not configured on the server.' });
    }

    const result = await whatsappService.sendMessage(accessToken, phoneNumberId, normalizedTo, message.trim());
    const waMessageId = result.messages?.[0]?.id;
    logger.info('WhatsApp message sent', { to: normalizedTo, messageId: waMessageId });

    recordOutboundConversation({
      userId:         req.user.id,
      to:             normalizedTo,
      messagePreview: message.trim(),
      messageType:    'text',
      waMessageId,
    }).catch(() => {});

    sendMetaCapiEvent({
      eventName: 'Contact',
      phone: normalizedTo,
      externalId: buildExternalIdFromPhone(normalizedTo),
      eventId: waMessageId,
      customData: { channel: 'whatsapp', lead_id: leadId || null },
    }).catch(() => {});

    res.json({ success: true, messageId: waMessageId });
  } catch (err) {
    logger.error('WhatsApp send error', { error: err.message });
    next(err);
  }
});

router.post('/send-template', async (req, res, next) => {
  try {
    const { to, templateName, languageCode, components } = req.body;
    const normalizedTo = normalizePhoneToE164(to) || to;

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
      accessToken, phoneNumberId, normalizedTo, templateName, languageCode || 'es', components || [],
    );
    const waMessageId = result.messages?.[0]?.id;

    recordOutboundConversation({
      userId:         req.user.id,
      to:             normalizedTo,
      messagePreview: `[template] ${templateName}`,
      messageType:    'template',
      waMessageId,
    }).catch(() => {});

    res.json({ success: true, messageId: waMessageId });
  } catch (err) {
    logger.error('WhatsApp send-template error', { error: err.message });
    next(err);
  }
});

module.exports = router;
