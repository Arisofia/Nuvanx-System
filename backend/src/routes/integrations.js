'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const integrationModel = require('../models/integration');
const credentialModel = require('../models/credential');
const metaService = require('../services/meta');
const whatsappService = require('../services/whatsapp');
const githubService = require('../services/github');
const leadModel = require('../models/lead');
const { pool, isAvailable } = require('../db');
const { config } = require('../config/env');
const { serviceParamRule, handleValidationErrors, connectRules } = require('../utils/validators');
const { integrationTestLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticate);

function normalizeMetaAdAccountId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const unprefixed = value.replace(/^act_/i, '');
  const digits = unprefixed.replace(/\D/g, '');
  return digits ? `act_${digits}` : '';
}

function normalizeMetaPageId(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits || '';
}

/**
 * Resolve a credential for the given service (async).
 * Priority: per-user vault → server-level env var defaults.
 *
 * The env-var fallback is gated by config.allowSharedCredentials (default true).
 * In production multi-tenant deployments, set ALLOW_SHARED_CREDENTIALS=false
 * to force every user to store their own key in the vault.
 */
async function resolveCredential(userId, service) {
  const stored = await credentialModel.getDecryptedKey(userId, service);
  if (stored) return stored;

  if (!config.allowSharedCredentials) {
    return null;
  }

  // Env-var fallbacks keyed by service name
  const envDefaults = {
    openai: config.openaiApiKey,
    gemini: config.geminiApiKey,
    meta: config.metaAccessToken,
    whatsapp: config.whatsappAccessToken,
    github: config.githubToken,
  };

  const envKey = envDefaults[service] || null;
  if (envKey && config.nodeEnv === 'production') {
    logger.warn('Using shared server-level env var credential in production — set per-user credentials via the vault', { userId, service });
  }
  return envKey;
}

/** GET /api/integrations - list all integrations with their status */
router.get('/', async (req, res, next) => {
  try {
    const integrations = await integrationModel.getAll(req.user.id);

    // Enrich each integration with credential availability so the UI
    // can distinguish "actually connected" from "status was seeded but
    // no credential exists".
    const enriched = await Promise.all(
      integrations.map(async (integ) => {
        const credential = await resolveCredential(req.user.id, integ.service);
        const hasCredential = !!credential;

        // Downgrade stale "connected" status when no credential is available
        let effectiveStatus = integ.status;
        if (integ.status === 'connected' && !hasCredential) {
          effectiveStatus = 'disconnected';
        }

        return { ...integ, status: effectiveStatus, hasCredential };
      }),
    );

    res.json({ success: true, integrations: enriched });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/integrations/validate-all
 * Test every service that has an available credential (vault or env-var).
 * WhatsApp is included when WHATSAPP_PHONE_NUMBER_ID is configured.
 * Runs all tests in parallel and returns the aggregated results.
 */
router.get('/validate-all', async (req, res, next) => {
  try {
  const userId = req.user.id;

  // Services testable without extra parameters
  const TESTABLE = [
    { service: 'meta', test: (k) => metaService.testConnection(k) },
    { service: 'github', test: (k) => githubService.testConnection(k) },
    {
      service: 'openai',
      test: () => Promise.resolve({ connected: true, message: 'Credential present — not validated in bulk check' }),
    },
    {
      service: 'gemini',
      test: () => Promise.resolve({ connected: true, message: 'Credential present — not validated in bulk check' }),
    },
  ];

  // Include WhatsApp when a default phone number ID is configured
  if (config.whatsappPhoneNumberId) {
    TESTABLE.push({
      service: 'whatsapp',
      test: (k) => whatsappService.testConnection(k, config.whatsappPhoneNumberId),
    });
  }

  const results = await Promise.allSettled(
    TESTABLE.map(async ({ service, test }) => {
      const credential = await resolveCredential(userId, service);
      if (!credential) {
        return { service, status: 'disconnected', connected: false, skipped: true };
      }

      try {
        const result = await test(credential);
        const status = result.connected ? 'connected' : result.stored ? 'stored' : 'error';
        await integrationModel.upsert(userId, service, {
          status,
          lastSync: result.connected ? new Date().toISOString() : undefined,
          lastError: result.error || null,
          metadata: {
            accountName: result.accountName,
            login: result.login,
            email: result.email,
            portalId: result.portalId,
          },
        });
        return { service, status, connected: result.connected, ...result };
      } catch (err) {
        await integrationModel.upsert(userId, service, { status: 'error', lastError: err.message });
        return { service, status: 'error', connected: false, error: err.message };
      }
    }),
  );

  const validated = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { service: TESTABLE[i].service, status: 'error', connected: false, error: r.reason?.message },
  );
  const connected = validated.filter((r) => r.connected).length;
  logger.info('validate-all completed', { userId, connected, total: validated.length });

  res.json({ success: true, validated, connected, total: validated.length });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/integrations/whatsapp/phone-numbers
 * Discover all WhatsApp phone numbers and their IDs registered to this business.
 * Uses the stored WHATSAPP_ACCESS_TOKEN (vault or env-var fallback).
 */
router.get('/whatsapp/phone-numbers', async (req, res, next) => {
  try {
    const token = await resolveCredential(req.user.id, 'whatsapp');
    if (!token) {
      return res.status(404).json({ success: false, message: 'No WhatsApp credential found. Set WHATSAPP_ACCESS_TOKEN.' });
    }
    const phoneNumbers = await whatsappService.discoverPhoneNumbers(token);
    logger.info('WhatsApp phone numbers discovered', { userId: req.user.id, count: phoneNumbers.length });
    res.json({ success: true, phoneNumbers });
  } catch (err) {
    next(err);
  }
});

/** POST /api/integrations/:service/test - test stored credential connection */
router.post(
  '/:service/test',
  integrationTestLimiter,
  serviceParamRule,
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    try {
      const apiKey = await resolveCredential(req.user.id, service);
      if (!apiKey) {
        return res.status(404).json({ success: false, message: `No credential found for ${service}` });
      }

      let result;
      switch (service) {
        case 'meta':
          result = await metaService.testConnection(apiKey);
          break;
        case 'whatsapp': {
          const { phoneNumberId } = req.body;
          if (!phoneNumberId) {
            return res.status(400).json({ success: false, message: 'phoneNumberId is required for WhatsApp' });
          }
          result = await whatsappService.testConnection(apiKey, phoneNumberId);
          break;
        }
        case 'github':
          result = await githubService.testConnection(apiKey);
          break;
        case 'openai':
        case 'gemini':
          // Basic key presence check — real validation happens on first generate call
          result = { connected: true, message: 'Credential stored and accessible' };
          break;
        default:
          return res.status(400).json({ success: false, message: 'Unknown service' });
      }

      const status = result.connected ? 'connected' : 'error';
      const testMetadata = {
        accountName: result.accountName,
        login: result.login,
        email: result.email,
        portalId: result.portalId,
      };
      if (service === 'meta') {
        const adAccountId = normalizeMetaAdAccountId(req.body.adAccountId || req.body.ad_account_id);
        if (adAccountId) {
          testMetadata.adAccountId = adAccountId;
          testMetadata.ad_account_id = adAccountId;
        }
      }
      await integrationModel.upsert(req.user.id, service, {
        status,
        lastSync: result.connected ? new Date().toISOString() : undefined,
        lastError: result.error || null,
        metadata: testMetadata,
      });

      logger.info('Integration test', { userId: req.user.id, service, connected: result.connected });
      res.json({ success: true, service, metadata: testMetadata, ...result });
    } catch (err) {
      await integrationModel.upsert(req.user.id, service, { status: 'error', lastError: err.message });
      next(err);
    }
  },
);

/**
 * PATCH /api/integrations/:service — update metadata fields for an integration
 * (e.g. adAccountId for Meta, phoneNumberId for WhatsApp).
 * Does not touch the credential vault or connection status.
 */
router.patch(
  '/:service',
  serviceParamRule,
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    const { metadata = {} } = req.body;

    try {
      const integrations = await integrationModel.getAll(req.user.id);
      const existing = integrations.find((i) => i.service === service);
      await integrationModel.upsert(req.user.id, service, {
        status: existing?.status || 'disconnected',
        metadata,
      });
      logger.info('Integration metadata updated', { userId: req.user.id, service });
      res.json({ success: true, message: `${service} metadata updated` });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/integrations/:service/connect - store OAuth token and mark connected */
router.post(
  '/:service/connect',
  serviceParamRule,
  connectRules,
  handleValidationErrors,
  async (req, res, next) => {
    const { service } = req.params;
    const { token, apiKey, metadata: rawMetadata = {} } = req.body;
    const credential = token || apiKey;

    if (!credential) {
      return res.status(400).json({ success: false, message: 'token or apiKey is required' });
    }

    try {
      const metadata = { ...rawMetadata };

      if (service === 'meta') {
        const adAccountId = normalizeMetaAdAccountId(metadata.adAccountId || metadata.ad_account_id);
        const pageId = normalizeMetaPageId(metadata.pageId || metadata.page_id);
        if (!adAccountId) {
          return res.status(400).json({
            success: false,
            message: 'Meta requires adAccountId (e.g. act_9523446201036125)',
          });
        }
        if (!pageId) {
          return res.status(400).json({
            success: false,
            message: 'Meta requires pageId (Facebook Page ID) for Lead Ads webhook ingestion',
          });
        }

        // Validate the token before persisting a "connected" state.
        const metaTest = await metaService.testConnection(credential);
        if (!metaTest.connected) {
          return res.status(400).json({
            success: false,
            message: metaTest.error || 'Invalid Meta token',
          });
        }

        metadata.adAccountId = adAccountId;
        metadata.ad_account_id = adAccountId;
        metadata.pageId = pageId;
        metadata.page_id = pageId;
        if (metaTest.accountName) metadata.accountName = metaTest.accountName;
      }

      if (service === 'whatsapp') {
        const phoneNumberId = String(metadata.phoneNumberId || metadata.phone_number_id || '').trim();
        if (!phoneNumberId) {
          return res.status(400).json({
            success: false,
            message: 'WhatsApp requires phoneNumberId',
          });
        }
        const waTest = await whatsappService.testConnection(credential, phoneNumberId);
        if (!waTest.connected) {
          return res.status(400).json({
            success: false,
            message: waTest.error || 'Invalid WhatsApp token or phoneNumberId',
          });
        }
        metadata.phoneNumberId = phoneNumberId;
      }

      await credentialModel.save(req.user.id, service, credential);
      await integrationModel.upsert(req.user.id, service, {
        status: 'connected',
        lastSync: new Date().toISOString(),
        lastError: null,
        metadata,
      });
      logger.info('Integration connected', { userId: req.user.id, service });
      res.json({ success: true, message: `${service} connected successfully`, metadata });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
