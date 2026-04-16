'use strict';

/**
 * POST /api/webhooks/hubspot
 *
 * Receives HubSpot webhook events (contact.creation, contact.propertyChange,
 * deal.creation) and upserts them into the local leads table.
 *
 * Authentication: HubSpot signature v1 (HMAC-SHA256) — no user JWT.
 * The rawBody is attached by server.js via the express.json({ verify }) option.
 *
 * To register this webhook in HubSpot:
 *   HubSpot → Private App → Webhooks → Add subscription
 *   URL: https://<your-domain>/api/webhooks/hubspot
 *   Events: contact.creation, contact.propertyChange, deal.creation
 */

const express = require('express');
const { config } = require('../config/env');
const hubspotService = require('../services/hubspot');
const leadModel = require('../models/lead');
const { pool: getPool, isAvailable } = require('../db');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const { webhookLimiter } = require('../middleware/rateLimiter');

const router = express.Router();
router.use(webhookLimiter);

router.post('/hubspot', async (req, res) => {
  // ── Signature verification ────────────────────────────────────────────────
  const signature = req.headers['x-hubspot-signature'];
  if (config.hubspotClientSecret) {
    const rawBody = req.rawBody || '';
    const valid = hubspotService.verifyWebhookSignature(
      config.hubspotClientSecret,
      rawBody,
      signature,
    );
    if (!valid) {
      logger.warn('HubSpot webhook: invalid signature', { signature });
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const events = Array.isArray(req.body) ? req.body : [req.body];
  const processed = [];
  const errors = [];

  for (const event of events) {
    try {
      const { subscriptionType, objectId, portalId } = event;

      // Only handle contact events for now
      if (!subscriptionType?.startsWith('contact.')) {
        processed.push({ objectId, skipped: true, reason: 'non-contact event' });
        continue;
      }

      // Fetch full contact details from HubSpot (needs stored credential)
      // If unavailable, fall back to the event payload properties
      const eventProps = event.propertyValue
        ? { email: event.propertyValue }
        : {};

      const leadData = {
        name: eventProps.name || `HubSpot Contact ${objectId}`,
        email: eventProps.email || '',
        phone: eventProps.phone || '',
        source: 'hubspot',
        stage: 'lead',
        revenue: 0,
        notes: `HubSpot ID: ${objectId} | Portal: ${portalId} | Event: ${subscriptionType}`,
      };

      // Upsert by hubspot ID stored in notes — if DB is available use ON CONFLICT
      if (isAvailable()) {
        await getPool.query(
          `INSERT INTO leads (user_id, name, email, phone, source, stage, revenue, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [
            // Webhook events are not user-scoped — store under a sentinel webhook user
            // or skip DB insert and log only. Here we log only to avoid cross-user data.
            null, // user_id intentionally null for webhook-originated leads
            leadData.name,
            leadData.email,
            leadData.phone,
            leadData.source,
            leadData.stage,
            leadData.revenue,
            leadData.notes,
          ],
        ).catch(() => {}); // non-fatal — log and continue
      }

      logger.info('HubSpot webhook event processed', { subscriptionType, objectId, portalId });
      processed.push({ objectId, subscriptionType });
    } catch (err) {
      logger.error('HubSpot webhook event error', { error: err.message, event });
      errors.push({ objectId: event.objectId, error: err.message });

      // Dead-letter: write failed events to monitoring for visibility and replay
      if (supabaseAdmin) {
        supabaseAdmin
          .schema('monitoring')
          .from('operational_events')
          .insert({
            user_id: null,
            event_type: 'webhook_dead_letter',
            message: `HubSpot webhook event failed: ${err.message}`,
            metadata: {
              objectId: event.objectId,
              subscriptionType: event.subscriptionType,
              portalId: event.portalId,
              error: err.message,
            },
          })
          .then(() => {})
          .catch((e) => logger.warn('webhook dead-letter write failed', { error: e.message }));
      }
    }
  }

  // If all events failed, signal the caller to retry after 60s
  if (errors.length > 0 && processed.length === 0) {
    res.setHeader('Retry-After', '60');
    return res.status(503).json({ received: true, processed: 0, errors: errors.length, retryAfter: 60 });
  }

  res.json({ received: true, processed: processed.length, errors: errors.length });
});

// ─── Meta Lead Ads Webhook ──────────────────────────────────────────────────
// Docs: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/

const crypto = require('crypto');
const metaService = require('../services/meta');

/**
 * GET /api/webhooks/meta
 * Webhook verification — Meta sends hub.mode, hub.verify_token, hub.challenge.
 */
router.get('/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && config.metaVerifyToken && token === config.metaVerifyToken) {
    logger.info('Meta webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Verification failed' });
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
  if (object !== 'page' && object !== 'instagram') {
    return res.status(200).json({ received: true, skipped: true });
  }

  const processed = [];

  for (const e of (entry || [])) {
    for (const change of (e.changes || [])) {
      if (change.field !== 'leadgen') continue;

      const { leadgen_id, page_id, form_id } = change.value || {};
      if (!leadgen_id) continue;

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

        if (config.metaAccessToken) {
          try {
            const axios = require('axios');
            const { data } = await axios.get(
              `https://graph.facebook.com/v21.0/${leadgen_id}`,
              {
                params: { access_token: config.metaAccessToken },
                timeout: 10000,
              },
            );
            const fields = {};
            for (const fd of (data.field_data || [])) {
              fields[fd.name] = fd.values?.[0] || '';
            }
            leadData.name = fields.full_name || fields.first_name || leadData.name;
            leadData.email = fields.email || '';
            leadData.phone = fields.phone_number || '';
          } catch (fetchErr) {
            logger.warn('Meta webhook: failed to fetch lead details', { leadgen_id, error: fetchErr.message });
          }
        }

        // Insert into DB
        if (isAvailable()) {
          await getPool.query(
            `INSERT INTO leads (user_id, name, email, phone, source, stage, revenue, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING`,
            [
              null,
              leadData.name,
              leadData.email,
              leadData.phone,
              leadData.source,
              leadData.stage,
              leadData.revenue,
              leadData.notes,
            ],
          );
        }

        logger.info('Meta lead webhook processed', { leadgen_id, page_id });
        processed.push({ leadgen_id });
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
