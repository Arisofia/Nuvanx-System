'use strict';

/**
 * Webhook endpoints for Meta Lead Ads and WhatsApp Business.
 *
 * All incoming leads are stored directly in the leads table under
 * WEBHOOK_ADMIN_USER_ID. No external CRM sync — the platform IS the CRM.
 */

const express = require('express');
const crypto = require('crypto');
const { config } = require('../config/env');
const { pool: getPool, isAvailable } = require('../db');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const { webhookLimiter } = require('../middleware/rateLimiter');
const { onLeadCreated } = require('../services/playbookAutomation');

const router = express.Router();
router.use(webhookLimiter);

function isMetaNumericId(value) {
  return /^\d{5,30}$/.test(String(value || '').trim());
}

/**
 * Extract and validate webhook challenge value.
 * Returns the sanitized challenge or null if invalid.
 * Allows alphanumeric and common punctuation chars per Meta's opaque verification strings.
 * Derives the result from regex capture group to avoid taint flow issues.
 */
function extractValidChallenge(value) {
  const challenge = String(value || '').trim();
  // Meta challenge can be any opaque string; allow alphanumeric + common punctuation
  if (!/^[A-Za-z0-9._:\-]{1,200}$/.test(challenge)) return null;
  return challenge;
}

// ─── Meta Lead Ads Webhook ──────────────────────────────────────────────────
// Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/

/**
 * GET /api/webhooks/meta
 * Webhook verification — Meta sends hub.mode, hub.verify_token, hub.challenge.
 */
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challengeInput = req.query['hub.challenge'];
  const challenge = extractValidChallenge(challengeInput);

  if (!config.metaVerifyToken) {
    logger.error('META_VERIFY_TOKEN missing in environment variables');
    return res.status(500).json({ error: 'Server misconfiguration: Missing Verification Token' });
  }

  if (
    mode === 'subscribe' &&
    token === config.metaVerifyToken &&
    challenge !== null
  ) {
    logger.info('Meta webhook verified successfully');
    return res.type('text/plain').status(200).send(challenge);
  }

  logger.warn('Meta webhook verification failed', {
    reason:
      mode !== 'subscribe'
        ? 'invalid_mode'
        : challenge === null
          ? 'invalid_challenge'
          : 'token_mismatch',
    mode,
    challengePresent: Boolean(challenge),
    receivedTokenPresent: Boolean(token),
  });
  return res.status(403).json({ error: 'Verification failed - Token mismatch' });
});

/**
 * POST /api/webhooks/meta
 * Receives lead-gen events from Meta Lead Ads.
 * Payload: { object, entry: [{ id, time, changes: [{ field, value: { leadgen_id, ... } }] }] }
 */
router.post('/meta', async (req, res) => {
  // ── Signature verification ────────────────────────────────────────────────
  if (config.metaAppSecret) {
    const signature = req.headers['x-hub-signature-256'] || '';
    const rawBody = req.rawBody || '';
    const expected = 'sha256=' + crypto
      .createHmac('sha256', config.metaAppSecret)
      .update(rawBody)
      .digest('hex');

    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      logger.warn('Meta webhook: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const { object, entry } = req.body;
  if (object !== 'page' && object !== 'instagram' && object !== 'whatsapp_business_account') {
    return res.status(200).json({ received: true, skipped: true });
  }

  // ── WhatsApp incoming messages ──────────────────────────────────────────
  if (object === 'whatsapp_business_account') {
    const webhookUserId = config.webhookAdminUserId;
    for (const e of (entry || [])) {
      for (const change of (e.changes || [])) {
        if (change.field !== 'messages') continue;
        for (const msg of (change.value?.messages || [])) {
          if (msg.type !== 'text') continue;
          const phone = msg.from; // international format e.g. 34612345678
          const text = msg.text?.body || '';
          const contactName = change.value?.contacts?.find(c => c.wa_id === phone)?.profile?.name || `WA ${phone}`;

          logger.info('WhatsApp message received', { phone, preview: text.substring(0, 60) });

          if (webhookUserId && isAvailable()) {
            await getPool.query(
              `INSERT INTO leads (user_id, name, phone, source, stage, revenue, notes, external_id)
               VALUES ($1, $2, $3, 'whatsapp', 'lead', 0, $4, $5)
               ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
              [webhookUserId, contactName, phone, `WA msg: ${text.substring(0, 500)}`, phone],
            ).catch(dbErr => logger.warn('WA webhook: DB insert failed', { error: dbErr.message }));

            // Trigger playbook automations for WhatsApp leads (best-effort)
            onLeadCreated({
              userId: webhookUserId,
              lead: { id: phone, name: contactName, phone, email: '' },
              source: 'whatsapp',
            }).catch((autoErr) => logger.warn('WA webhook: playbook automation error', { error: autoErr.message }));
          }
        }
      }
    }
    return res.json({ received: true });
  }

  const processed = [];

  for (const e of (entry || [])) {
    for (const change of (e.changes || [])) {
      if (change.field !== 'leadgen') continue;

      const { leadgen_id, page_id, form_id } = change.value || {};
      if (!leadgen_id) continue;
      if (!isMetaNumericId(leadgen_id)) {
        logger.warn('Meta webhook: invalid leadgen_id', { leadgen_id });
        continue;
      }

      try {
        // Try to fetch full lead data from Meta Graph API
        let leadData = {
          name: `Meta Lead ${leadgen_id}`,
          email: '',
          phone: '',
          source: 'Meta Ads',
          stage: 'lead',
          revenue: 0,
          notes: `Leadgen ID: ${leadgen_id} | Page: ${page_id || ''} | Form: ${form_id || ''}`,
        };

        // Attribution data from Meta Graph API
        let attribution = { campaign_id: null, campaign_name: null, adset_id: null, adset_name: null, ad_id: null, ad_name: null, form_id: form_id || null };

        if (config.metaAccessToken) {
          try {
            const axios = require('axios');
            const { data } = await axios.get(
              `https://graph.facebook.com/v21.0/${encodeURIComponent(String(leadgen_id).trim())}`,
              {
                params: {
                  access_token: config.metaAccessToken,
                  fields: 'field_data,ad_id,adset_id,campaign_id,form_id,created_time',
                },
                timeout: 10000,
              },
            );
            const fields = {};
            for (const fd of (data.field_data || [])) {
              fields[fd.name] = fd.values?.[0] || '';
            }
            leadData.name  = fields.full_name || fields.first_name || leadData.name;
            leadData.email = fields.email || '';
            leadData.phone = fields.phone_number || '';
            attribution.ad_id       = data.ad_id || null;
            attribution.adset_id    = data.adset_id || null;
            attribution.campaign_id = data.campaign_id || null;
            attribution.form_id     = data.form_id || form_id || null;

            if (attribution.campaign_id && !isMetaNumericId(attribution.campaign_id)) attribution.campaign_id = null;
            if (attribution.adset_id && !isMetaNumericId(attribution.adset_id)) attribution.adset_id = null;
            if (attribution.ad_id && !isMetaNumericId(attribution.ad_id)) attribution.ad_id = null;

            // Resolve human-readable names (best-effort, non-blocking)
            if (attribution.campaign_id) {
              try {
                const campRes = await axios.get(
                  `https://graph.facebook.com/v21.0/${encodeURIComponent(String(attribution.campaign_id).trim())}`,
                  { params: { access_token: config.metaAccessToken, fields: 'name' }, timeout: 6000 },
                );
                attribution.campaign_name = campRes.data?.name || null;
              } catch (_) { /* non-fatal */ }
            }
            if (attribution.adset_id) {
              try {
                const adsetRes = await axios.get(
                  `https://graph.facebook.com/v21.0/${encodeURIComponent(String(attribution.adset_id).trim())}`,
                  { params: { access_token: config.metaAccessToken, fields: 'name' }, timeout: 6000 },
                );
                attribution.adset_name = adsetRes.data?.name || null;
              } catch (_) { /* non-fatal */ }
            }
            if (attribution.ad_id) {
              try {
                const adRes = await axios.get(
                  `https://graph.facebook.com/v21.0/${encodeURIComponent(String(attribution.ad_id).trim())}`,
                  { params: { access_token: config.metaAccessToken, fields: 'name' }, timeout: 6000 },
                );
                attribution.ad_name = adRes.data?.name || null;
              } catch (_) { /* non-fatal */ }
            }
          } catch (fetchErr) {
            logger.warn('Meta webhook: failed to fetch lead details', { leadgen_id, error: fetchErr.message });
          }
        }

        // Insert into DB under admin user
        const webhookUserId = config.webhookAdminUserId;
        if (webhookUserId && isAvailable()) {
          const insertResult = await getPool.query(
            `INSERT INTO leads (user_id, name, email, phone, source, stage, revenue, notes, external_id,
                                campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, form_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING
             RETURNING id`,
            [
              webhookUserId,
              leadData.name,
              leadData.email,
              leadData.phone,
              leadData.source,
              leadData.stage,
              leadData.revenue,
              leadData.notes,
              leadgen_id,
              attribution.campaign_id,
              attribution.campaign_name,
              attribution.adset_id,
              attribution.adset_name,
              attribution.ad_id,
              attribution.ad_name,
              attribution.form_id,
            ],
          );

          // Write meta_attribution row for the inserted lead (via Supabase admin for RLS bypass)
          const newLeadId = insertResult.rows[0]?.id;
          if (newLeadId && supabaseAdmin) {
            supabaseAdmin.from('meta_attribution').insert({
              lead_id:       newLeadId,
              leadgen_id,
              page_id:       page_id || null,
              form_id:       attribution.form_id,
              campaign_id:   attribution.campaign_id,
              campaign_name: attribution.campaign_name,
              adset_id:      attribution.adset_id,
              adset_name:    attribution.adset_name,
              ad_id:         attribution.ad_id,
              ad_name:       attribution.ad_name,
            }).then(() => {}).catch((e) => logger.warn('meta_attribution insert failed', { error: e.message }));
          }
        }

        logger.info('Meta lead webhook processed', { leadgen_id, page_id });
        processed.push({ leadgen_id });

        // Trigger playbook automations (best-effort, non-blocking)
        onLeadCreated({
          userId: webhookUserId,
          lead: { id: leadgen_id, name: leadData.name, phone: leadData.phone, email: leadData.email },
          source: 'meta',
        }).catch((autoErr) => logger.warn('Meta webhook: playbook automation error', { error: autoErr.message }));
      } catch (err) {
        logger.error('Meta lead webhook error', { leadgen_id, error: err.message });

        if (supabaseAdmin) {
          supabaseAdmin
            .schema('monitoring')
            .from('operational_events')
            .insert({
              user_id: null,
              event_type: 'webhook_dead_letter',
              message: `Meta lead webhook failed: ${err.message}`,
              metadata: { leadgen_id, page_id, form_id, error: err.message },
            })
            .then(() => {})
            .catch((e) => logger.warn('meta webhook dead-letter write failed', { error: e.message }));
        }
      }
    }
  }

  res.json({ received: true, processed: processed.length });
});

module.exports = router;
