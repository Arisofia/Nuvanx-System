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
const { supabaseAdmin } = require('../config/supabase');
const whatsappService = require('./whatsapp');
const { normalizePhoneForMeta } = require('../utils/phone');
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

  const to = normalizePhoneForMeta(lead.phone);
  if (!to) {
    logger.warn('[playbook-auto] lead_capture_nurture skipped — invalid lead phone', {
      leadId: lead.id,
      phone: lead.phone,
    });
    return;
  }

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
        let agentOutputId = null;
        if (supabaseAdmin) {
          const { data: user, error: userError } = await supabaseAdmin
            .from('users')
            .select('clinic_id')
            .eq('id', userId)
            .single();

          if (userError) {
            logger.warn('[playbook-auto] Unable to resolve clinic_id for agent output persistence', {
              error: userError.message,
            });
          }

          const { data, error } = await supabaseAdmin
            .from('agent_outputs')
            .insert({
              user_id: userId,
              clinic_id: user?.clinic_id || null,
              agent_type: 'playbook.auto',
              output: {
                playbookSlug: 'lead_capture_nurture',
                leadId: lead.id,
                phone: to,
                message,
              },
              metadata: {
                source: 'backend.playbookAutomation',
                leadId: lead.id,
                phone: to,
              },
            })
            .select('id')
            .single();

          if (error) {
            logger.warn('[playbook-auto] Failed to persist agent output', {
              hasUserId: Boolean(userId),
              error: error.message,
            });
          } else {
            agentOutputId = data?.id || null;
          }
        }

        const executionMetadata = {
          leadId: lead.id,
          phone: to,
          ...(agentOutputId ? { agent_output_id: agentOutputId } : {}),
        };

        await pool.query(
          `INSERT INTO public.playbook_executions (playbook_id, user_id, status, metadata, agent_output_id)
           VALUES ($1, $2, 'success', $3, $4)`,
          [rows[0].id, userId, JSON.stringify(executionMetadata), agentOutputId],
        );
      }
    } catch (dbErr) {
      logger.warn('[playbook-auto] Failed to record execution', { error: dbErr.message });
    }
  }
}

module.exports = { onLeadCreated };
