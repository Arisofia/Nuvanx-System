'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const credentialModel = require('../models/credential');
const whatsappService = require('../services/whatsapp');
const { config } = require('../config/env');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

/**
 * Resolve WhatsApp credentials from the per-user vault.
 * seed-credentials.yml stores WhatsApp as JSON:
 *   { access_token: "...", phone_number_id: "..." }
 * Returns { accessToken, phoneNumberId } — either field may be null.
 */
async function resolveWhatsAppCredentials(userId) {
  const stored = await credentialModel.getDecryptedKey(userId, 'whatsapp');
  let accessToken = null;
  let phoneNumberId = null;

  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        accessToken = parsed.access_token || null;
        phoneNumberId = parsed.phone_number_id || null;
      } else {
        accessToken = stored;
      }
    } catch {
      accessToken = stored; // bare token string
    }
  }

  // Fall back to server-level env vars when shared credentials are allowed
  if (!accessToken && config.allowSharedCredentials) accessToken = config.whatsappAccessToken || null;
  if (!phoneNumberId) phoneNumberId = config.whatsappPhoneNumberId || null;

  return { accessToken, phoneNumberId };
}

/**
 * Persist outbound WhatsApp conversation record.
 * Resolves lead_id and clinic_id from phone (phone_normalized match) — best-effort.
 */
async function recordOutboundConversation({ userId, to, messagePreview, messageType, waMessageId }) {
  if (!supabaseAdmin) return;
  try {
    // Resolve clinic_id from the user
    const { data: usr } = await supabaseAdmin.from('users').select('clinic_id').eq('id', userId).single();
    if (!usr?.clinic_id) return;

    // Try to find a lead by phone_normalized
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, first_outbound_at')
      .eq('phone_normalized', to)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const now = new Date().toISOString();

    // Insert conversation record
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

    // Update leads.first_outbound_at if this is the first outbound message
    if (lead?.id && !lead.first_outbound_at) {
      await supabaseAdmin.from('leads').update({ first_outbound_at: now }).eq('id', lead.id);

      // Timeline event
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

/**
 * POST /api/whatsapp/send
 * Send a WhatsApp text message to a recipient.
 * Body: { to: string (E.164), message: string, leadId?: string }
 */
router.post('/send', async (req, res, next) => {
  try {
    const { to, message, leadId } = req.body;

    if (!to || typeof to !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing or invalid "to" (E.164 phone number).' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Missing or empty "message".' });
    }

    // Resolve WhatsApp credentials: vault JSON first, then env var fallback
    const { accessToken, phoneNumberId } = await resolveWhatsAppCredentials(req.user.id);

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
    const waMessageId = result.messages?.[0]?.id;
    logger.info('WhatsApp message sent', { to, messageId: waMessageId });

    // Record conversation (non-blocking)
    recordOutboundConversation({
      userId:         req.user.id,
      to,
      messagePreview: message.trim(),
      messageType:    'text',
      waMessageId,
    }).catch(() => {});

    res.json({ success: true, messageId: waMessageId });
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

    const { accessToken, phoneNumberId } = await resolveWhatsAppCredentials(req.user.id);

    if (!accessToken) {
      return res.status(404).json({ success: false, message: 'WhatsApp integration not connected.' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ success: false, message: 'WHATSAPP_PHONE_NUMBER_ID not configured.' });
    }

    const result = await whatsappService.sendTemplateMessage(
      accessToken, phoneNumberId, to, templateName, languageCode || 'es', components || [],
    );
    const waMessageId = result.messages?.[0]?.id;

    // Record conversation (non-blocking)
    recordOutboundConversation({
      userId:         req.user.id,
      to,
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
