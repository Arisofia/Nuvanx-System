'use strict';

/**
 * Playbook automation engine.
 *
 * Executes playbook trigger actions after a lead is created via webhook.
 * Currently supports:
 *   - lead_capture_nurture: sends a WhatsApp welcome message to new leads
 *     that arrive with a phone number from Meta Lead Ads.
 */

const { config } = require('../config/env');
const { pool, isAvailable } = require('../db');
const whatsappService = require('./whatsapp');
const credentialModel = require('../models/credential');
const logger = require('../utils/logger');

/**
 * Run applicable playbook triggers after a new lead is created.
 * @param {{ userId: string, lead: object, source: string }} ctx
 */
async function onLeadCreated({ userId, lead, source }) {
  if (!lead || !lead.phone) return;

  // lead_capture_nurture: auto-send WhatsApp welcome if connected
  try {
    await runLeadCaptureNurture(userId, lead);
  } catch (err) {
    logger.warn('[playbook-auto] lead_capture_nurture failed', {
      leadId: lead.id,
      error: err.message,
    });
  }
}

/**
 * Sends a WhatsApp welcome message to a newly captured lead.
 * Requires: WhatsApp integration connected + lead has phone number.
 */
async function runLeadCaptureNurture(userId, lead) {
  const waToken = await credentialModel.getDecryptedKey(userId, 'whatsapp');
  if (!waToken) return; // WhatsApp not connected

  const phoneNumberId = config.whatsappPhoneNumberId;
  if (!phoneNumberId) {
    logger.debug('[playbook-auto] WHATSAPP_PHONE_NUMBER_ID not set — skipping welcome');
    return;
  }

  const to = lead.phone.replace(/[^0-9]/g, ''); // strip non-digits
  if (to.length < 10) return; // too short to be valid

  const name = lead.name || 'there';
  const message = `👋 Hola ${name}! Gracias por tu interés. Un miembro de nuestro equipo se comunicará contigo pronto. ¿Hay algo en lo que podamos ayudarte?`;

  await whatsappService.sendMessage(waToken, phoneNumberId, to, message);

  logger.info('[playbook-auto] WhatsApp welcome sent', {
    leadId: lead.id,
    to,
  });

  // Record playbook execution if DB available
  if (isAvailable()) {
    try {
      const { rows } = await pool.query(
        "SELECT id FROM public.playbooks WHERE slug = 'lead_capture_nurture' LIMIT 1",
      );
      if (rows[0]) {
        await pool.query(
          `INSERT INTO public.playbook_executions (playbook_id, user_id, status, metadata)
           VALUES ($1, $2, 'success', $3)`,
          [rows[0].id, userId, JSON.stringify({ leadId: lead.id, phone: to })],
        );
      }
    } catch (dbErr) {
      logger.warn('[playbook-auto] Failed to record execution', { error: dbErr.message });
    }
  }
}

module.exports = { onLeadCreated };
