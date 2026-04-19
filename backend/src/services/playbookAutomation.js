'use strict';

/**
 * Playbook automation engine.
 *
 * Executes playbook trigger actions after a lead is created via webhook.
 * Uses the durable playbookRunner for idempotent, retried, and audited execution.
 *
 * Currently supported triggers:
 *   - lead-capture-nurture: sends a WhatsApp welcome message to new leads
 *     that arrive with a phone number from Meta Lead Ads or WhatsApp.
 */

const { config } = require('../config/env');
const whatsappService = require('./whatsapp');
const credentialModel = require('../models/credential');
const playbookRunner = require('./playbookRunner');
const logger = require('../utils/logger');

/**
 * Run applicable playbook triggers after a new lead is created.
 * @param {{ userId: string, lead: object, source: string }} ctx
 */
async function onLeadCreated({ userId, lead, source }) {
  if (!lead || !lead.phone) return;

  if (!lead.id) {
    // Without an id we cannot set an idempotency key, so duplicate welcome
    // messages are possible.  Log and skip rather than proceeding unprotected.
    logger.warn('[playbook-auto] lead has no id — skipping to avoid duplicate welcome', { source });
    return;
  }

  // Idempotency key prevents duplicate welcome messages for the same lead
  const idempotencyKey = `lead_capture_nurture:${lead.id}`;

  await playbookRunner.run({
    playbookSlug: 'lead-capture-nurture',
    userId,
    context: { leadId: lead.id, source, idempotencyKey },
    steps: [
      {
        name: 'whatsapp_welcome',
        fn: async () => {
          const waToken = await credentialModel.getDecryptedKey(userId, 'whatsapp');
          if (!waToken) {
            logger.debug('[playbook-auto] WhatsApp not connected — skipping welcome');
            return {};
          }

          const phoneNumberId = config.whatsappPhoneNumberId;
          if (!phoneNumberId) {
            logger.debug('[playbook-auto] WHATSAPP_PHONE_NUMBER_ID not set — skipping welcome');
            return {};
          }

          const to = lead.phone.replace(/[^0-9]/g, ''); // strip non-digits
          if (to.length < 10) return {}; // too short to be valid

          const name = lead.name || 'there';
          const message = `👋 Hola ${name}! Gracias por tu interés. Un miembro de nuestro equipo se comunicará contigo pronto. ¿Hay algo en lo que podamos ayudarte?`;

          await whatsappService.sendMessage(waToken, phoneNumberId, to, message);
          logger.info('[playbook-auto] WhatsApp welcome sent', { leadId: lead.id, to });

          return { to, leadId: lead.id };
        },
      },
    ],
  });
}

module.exports = { onLeadCreated };
